// Headless simulation: events at given times in, sampled states and values out,
// plus a summary an AI can read without looking at every sample.

import { createRuntime, type Runtime, type Value } from "./runtime.ts";
import type { Program } from "./types.ts";

/**
 * An event, or an input sample (v0.2), at a time in seconds. `implied` marks events a
 * helper added (a drag's down and up), which aren't reported as unhandled.
 */
export type TimedEvent = { t: number; event: string; implied?: boolean } | { t: number; input: string; value: number };

export interface SimulateOptions {
  /** Events and input samples. Ties keep their order. */
  events: TimedEvent[];
  /** Leaf state paths to start in, instead of `initial`. */
  start?: string[];
  /** Reduced motion (v0.3): short linear tweens everywhere, no kicks. */
  reducedMotion?: boolean;
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
  /**
   * How far past its target the value went, at most, in the direction it was traveling;
   * measured per target (each time an event or timer changes where the value is heading),
   * so a press that goes 0 → 6 → 0 without bouncing has an overshoot of 0.
   */
  overshoot?: number;
  /** When the property came to rest for good, or undefined if it hadn't by `until`. */
  settledAt?: number;
}

export interface Simulation {
  samples: Sample[];
  summary: Record<string, PropertySummary>;
  /** Events that no state handled, and input samples for unknown inputs. Often a typo, sometimes intended. */
  unhandled: TimedEvent[];
}

/**
 * The events and input samples of one drag: down and dragstart at `from`, the pointer
 * moving evenly by (dx, dy) at `rate` samples per second, then up and dragend at `to`.
 */
export function dragGesture(target: string, from: number, to: number, dx: number, dy = 0, rate = 60): TimedEvent[] {
  const out: TimedEvent[] = [
    { t: from, event: `${target}.down`, implied: true },
    { t: from, event: `${target}.dragstart` },
  ];
  const n = Math.max(1, Math.round((to - from) * rate));
  for (let k = 1; k <= n; k++) {
    const t = round(from + ((to - from) * k) / n);
    out.push({ t, input: `${target}.drag.x`, value: round((dx * k) / n) });
    if (dy) out.push({ t, input: `${target}.drag.y`, value: round((dy * k) / n) });
  }
  out.push({ t: to, event: `${target}.up`, implied: true }, { t: to, event: `${target}.dragend` });
  return out;
}

/** Applies one event or input sample; false if nothing used it. */
export function apply(rt: Runtime, e: TimedEvent): boolean {
  return "event" in e ? rt.send(e.event, e.t) : rt.input(e.input, e.value, e.t);
}

export function describeEvent(e: TimedEvent): string {
  return "event" in e ? `${e.event}@${e.t}` : `${e.input}=${e.value}@${e.t}`;
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
  const start = { state: options.start, reducedMotion: options.reducedMotion };
  const until = options.until ?? round(Math.ceil(findSettle(program, events, lastEvent, start) / every - 1e-9) * every);

  // Pass 1: samples at the requested interval.
  const samples: Sample[] = [];
  const unhandled: TimedEvent[] = [];
  {
    const rt = createRuntime(program, start);
    let next = 0;
    const steps = Math.round(until / every);
    for (let i = 0; i <= steps; i++) {
      const t = round(i * every);
      while (next < events.length && events[next].t <= t) {
        const e = events[next];
        if (!apply(rt, e) && !("event" in e && e.implied)) unhandled.push(e);
        next++;
      }
      // Sampling advances the clock (timers may fire), so sample before reading the state.
      const values = pick(rt.sample(t), keys);
      samples.push({ t, state: rt.state(), values });
    }
  }

  // Pass 2: a fine scan for extremes and settle times.
  const summary: Record<string, PropertySummary> = {};
  {
    const rt = createRuntime(program, start);
    const settledSince = new Map<string, number | undefined>();
    const extremes = new Map<string, [number, number]>();
    // Per target: where the value started heading there, and the furthest it went past.
    const legs = new Map<string, { target: number; from: number; over: number }>();
    const overshoots = new Map<string, number>();
    let next = 0;
    let last: Record<string, Value> = {};
    const steps = Math.round(until / SCAN_STEP);
    for (let i = 0; i <= steps; i++) {
      const t = round(i * SCAN_STEP);
      while (next < events.length && events[next].t <= t) {
        apply(rt, events[next]);
        next++;
      }
      last = rt.sample(t);
      const targetsNow = rt.targets();
      for (const key of keys) {
        const v = last[key];
        if (typeof v === "number") {
          const [lo, hi] = extremes.get(key) ?? [v, v];
          extremes.set(key, [Math.min(lo, v), Math.max(hi, v)]);
          const target = targetsNow[key];
          if (typeof target === "number") {
            let leg = legs.get(key);
            if (!leg || leg.target !== target) {
              leg = { target, from: v, over: 0 };
              legs.set(key, leg);
            }
            // Past the target in the direction of travel.
            const past = target >= leg.from ? v - target : target - v;
            if (past > leg.over) leg.over = past;
            if (leg.over > (overshoots.get(key) ?? 0)) overshoots.set(key, leg.over);
          }
        }
        if (!rt.settled(t, key)) settledSince.set(key, undefined);
        else if (settledSince.get(key) === undefined) settledSince.set(key, t);
      }
    }
    for (const key of keys) {
      const s: PropertySummary = { final: last[key] };
      const ex = extremes.get(key);
      if (ex) [s.min, s.max] = ex;
      if (ex) s.overshoot = overshoots.get(key) ?? 0;
      const at = settledSince.get(key);
      if (at !== undefined) s.settledAt = at;
      summary[key] = s;
    }
  }

  return { samples, summary, unhandled };
}

/** Earliest time after the last event when everything is at rest, capped. */
function findSettle(program: Program, events: TimedEvent[], lastEvent: number, start: { state?: string[]; reducedMotion?: boolean }): number {
  const rt = createRuntime(program, start);
  for (const e of events) apply(rt, e);
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
