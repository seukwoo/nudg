// The timeline a side-by-side comparison plays on: one clock for both versions that can
// run slow, the bundle's steps delivered when they fall due, and a fresh start once both
// have rested a moment. Platform-free; React Native's NudgCompare drives it every frame
// (SwiftUI and Compose keep the same rules in their own code).

import { programFromJson } from "./program-json.ts";
import type { TimedEvent } from "./simulate.ts";
import type { Program } from "./types.ts";

/** How long a run lingers at rest before it starts over. */
export const COMPARE_PAUSE = 0.8;

/** A comparison bundle read back: what `compareBundle` wrote, with the programs decoded. */
export interface ComparisonData {
  labels: [string, string];
  headline: string;
  suggestion?: string;
  properties: { property: string; verdict: string; summary: string }[];
  steps: TimedEvent[];
  start?: string[];
  reducedMotion: boolean;
  until: number;
  a: Program;
  b: Program;
}

/** Reads `nudg compare --bundle` output (the parsed JSON). */
export function readCompareBundle(json: unknown): ComparisonData {
  const j = json as Record<string, any>;
  if (j?.nudgCompare !== 1 || !Array.isArray(j.labels) || j.labels.length !== 2) throw new Error("Not a nudg comparison bundle (format 1). Write one with `nudg compare a b --bundle x.compare.json`.");
  return {
    labels: [String(j.labels[0]), String(j.labels[1])],
    headline: String(j.headline ?? ""),
    ...(typeof j.suggestion === "string" ? { suggestion: j.suggestion } : {}),
    properties: Array.isArray(j.properties) ? j.properties : [],
    steps: Array.isArray(j.events) ? j.events : [],
    ...(Array.isArray(j.start) ? { start: j.start } : {}),
    reducedMotion: j.reducedMotion === true,
    until: Number(j.until) || 0,
    a: programFromJson(j.a),
    b: programFromJson(j.b),
  };
}

export interface CompareTimeline {
  /** Seconds on the shared clock: what both players read as their host's time. */
  now(): number;
  /** Seconds into the current run, on the comparison's timeline. */
  elapsed(): number;
  /** 1, 0.25 or 0.1: how fast the shared clock runs. */
  speed: number;
  /** Starts the timeline over; the host makes new players. */
  restart(): void;
  /** The steps that fell due since the last call, and whether the run just started over. */
  due(): { steps: TimedEvent[]; restarted: boolean };
}

/** `wall` is the host's clock in seconds. */
export function compareTimeline(data: Pick<ComparisonData, "steps" | "until">, wall: () => number): CompareTimeline {
  let speed = 1;
  let anchor = { wall: wall(), virtual: 0 };
  const now = () => anchor.virtual + (wall() - anchor.wall) * speed;
  let runStart = 0;
  let next = 0;
  const restart = () => {
    runStart = now();
    next = 0;
  };
  return {
    now,
    elapsed: () => now() - runStart,
    get speed() {
      return speed;
    },
    set speed(value: number) {
      if (!(value > 0)) throw new RangeError("`speed` must be greater than 0.");
      anchor = { wall: wall(), virtual: now() };
      speed = value;
    },
    restart,
    due() {
      const t = now() - runStart;
      const steps: TimedEvent[] = [];
      while (next < data.steps.length && data.steps[next].t <= t) steps.push(data.steps[next++]);
      if (next === data.steps.length && t > data.until + COMPARE_PAUSE) {
        restart();
        return { steps, restarted: true };
      }
      return { steps, restarted: false };
    },
  };
}
