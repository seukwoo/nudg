// Headless simulation: events at given times in, sampled states and values out,
// plus a summary an AI can read without looking at every sample.

import { createRuntime, type Value } from "./runtime.ts";
import type { Program } from "./types.ts";

export interface TimedEvent {
  t: number;
  event: string;
}

export interface SimulateOptions {
  events: TimedEvent[];
  /** Last sample time. Defaults to when everything settles after the last event. */
  until?: number;
  /** Seconds between samples. Defaults to 0.05. */
  every?: number;
  /** Properties to report. Defaults to all. */
  properties?: string[];
}

export interface Sample {
  t: number;
  state: string[];
  values: Record<string, Value>;
}

export interface PropertySummary {
  /** Value after the last sample. */
  final: Value;
  /** Numeric properties only, scanned at 1 ms resolution. */
  min?: number;
  max?: number;
  /** When the property came to rest for good, or undefined if it hadn't by `until`. */
  settledAt?: number;
}

export interface Simulation {
  samples: Sample[];
  summary: Record<string, PropertySummary>;
  /** Events that no state handled. Often a typo, sometimes intended. */
  unhandled: TimedEvent[];
}

const SCAN_STEP = 0.001;
const MAX_SETTLE = 10;

export function simulate(program: Program, options: SimulateOptions): Simulation {
  const events = [...options.events].sort((a, b) => a.t - b.t);
  const every = options.every ?? 0.05;
  if (!(every > 0)) throw new RangeError("`every` must be greater than 0.");
  const keys = options.properties ?? [...program.properties.keys()];
  for (const key of keys) {
    if (!program.properties.has(key)) throw new Error(`Unknown property "${key}".`);
  }

  const lastEvent = events.length ? events[events.length - 1].t : 0;
  const until = options.until ?? round(Math.ceil(findSettle(program, events, lastEvent) / every - 1e-9) * every);

  // Pass 1: samples at the requested interval.
  const samples: Sample[] = [];
  const unhandled: TimedEvent[] = [];
  {
    const rt = createRuntime(program);
    let next = 0;
    const steps = Math.round(until / every);
    for (let i = 0; i <= steps; i++) {
      const t = round(i * every);
      while (next < events.length && events[next].t <= t) {
        if (!rt.send(events[next].event, events[next].t)) unhandled.push(events[next]);
        next++;
      }
      samples.push({ t, state: rt.state(), values: pick(rt.sample(t), keys) });
    }
  }

  // Pass 2: a fine scan for extremes and settle times.
  const summary: Record<string, PropertySummary> = {};
  {
    const rt = createRuntime(program);
    const settledSince = new Map<string, number | undefined>();
    const extremes = new Map<string, [number, number]>();
    let next = 0;
    let last: Record<string, Value> = {};
    const steps = Math.round(until / SCAN_STEP);
    for (let i = 0; i <= steps; i++) {
      const t = round(i * SCAN_STEP);
      while (next < events.length && events[next].t <= t) {
        rt.send(events[next].event, events[next].t);
        next++;
      }
      last = rt.sample(t);
      for (const key of keys) {
        const v = last[key];
        if (typeof v === "number") {
          const [lo, hi] = extremes.get(key) ?? [v, v];
          extremes.set(key, [Math.min(lo, v), Math.max(hi, v)]);
        }
        if (!rt.settled(t, key)) settledSince.set(key, undefined);
        else if (settledSince.get(key) === undefined) settledSince.set(key, t);
      }
    }
    for (const key of keys) {
      const s: PropertySummary = { final: last[key] };
      const ex = extremes.get(key);
      if (ex) [s.min, s.max] = ex;
      const at = settledSince.get(key);
      if (at !== undefined) s.settledAt = at;
      summary[key] = s;
    }
  }

  return { samples, summary, unhandled };
}

/** Earliest time after the last event when everything is at rest, capped. */
function findSettle(program: Program, events: TimedEvent[], lastEvent: number): number {
  const rt = createRuntime(program);
  for (const e of events) rt.send(e.event, e.t);
  for (let t = lastEvent; t <= lastEvent + MAX_SETTLE; t += 0.01) {
    if (rt.settled(t)) return Math.max(t, lastEvent + 0.1);
  }
  return lastEvent + MAX_SETTLE;
}

function pick(values: Record<string, Value>, keys: string[]): Record<string, Value> {
  const out: Record<string, Value> = {};
  for (const key of keys) out[key] = values[key];
  return out;
}

function round(t: number): number {
  return Math.round(t * 1e6) / 1e6;
}
