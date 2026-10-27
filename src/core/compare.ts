// Compares two versions of an interaction under the same events and says, before
// anything else, whether a person would notice the difference. Graphs and filmstrips
// show the change; this tells the judge where to look, or that there is nothing to see.

import { hexToOklab } from "./color.ts";
import { programToJson } from "./program-json.ts";
import { simulate, type SimulateOptions, type Simulation } from "./simulate.ts";
import type { Program } from "./types.ts";

export type Perceptibility = "imperceptible" | "subtle" | "clear";

export interface PropertyDifference {
  property: string;
  /** Largest difference between the two versions at the same moment, in logical units (colors: OKLab distance ×100). */
  maxDifference: number;
  /** When that largest difference happens. */
  at: number;
  /** Overshoot past the final value, A and B (numeric properties). */
  overshoot?: [number, number];
  /** When each version came to rest, if it did. */
  settledAt: [number | undefined, number | undefined];
  verdict: Perceptibility;
  /** One sentence for the judge. */
  summary: string;
}

export interface Comparison {
  a: Simulation;
  b: Simulation;
  properties: PropertyDifference[];
  /** The strongest verdict among the properties. */
  verdict: Perceptibility;
  /** What the tool says first. */
  headline: string;
  /** The next turn the tool proposes, if any. */
  suggestion?: string;
  /** True when nothing differs under these events: nothing to show a person. */
  identical: boolean;
}

/**
 * Perception thresholds, in logical units and seconds. Below them a change is lost in the
 * display: under a device pixel at 1×, or under about three frames at 60 Hz. Rough, on
 * purpose: the point is to stop a judge from staring at a change nobody can see.
 */
export const THRESHOLDS = {
  position: { imperceptible: 1, subtle: 3 },
  /** Fractions of 1 for scale and opacity. */
  fraction: { imperceptible: 0.02, subtle: 0.06 },
  /** OKLab distance ×100. */
  color: { imperceptible: 2, subtle: 6 },
  time: { imperceptible: 0.05, subtle: 0.15 },
};

const FRACTIONAL = new Set(["scale", "scaleX", "scaleY", "opacity"]);

export function compare(a: Program, b: Program, options: SimulateOptions): Comparison {
  const every = options.every ?? 1 / 120;
  // Both versions over the same span: the later of the two settle times.
  let simA2 = simulate(a, { ...options, every });
  let simB = simulate(b, { ...options, every });
  const until = options.until ?? Math.max(lastTime(simA2), lastTime(simB));
  if (lastTime(simA2) < until) simA2 = simulate(a, { ...options, every, until });
  if (lastTime(simB) < until) simB = simulate(b, { ...options, every, until });
  const keys = (options.properties ?? [...a.properties.keys()]).filter((k) => b.properties.has(k));
  const properties: PropertyDifference[] = [];

  for (const key of keys) {
    const kind = a.properties.get(key)!.kind;
    const prop = key.split(".")[1];
    const scale = kind === "color" ? THRESHOLDS.color : FRACTIONAL.has(prop) ? THRESHOLDS.fraction : THRESHOLDS.position;
    let maxDifference = 0;
    let at = 0;
    const n = Math.min(simA2.samples.length, simB.samples.length);
    for (let i = 0; i < n; i++) {
      const va = simA2.samples[i].values[key];
      const vb = simB.samples[i].values[key];
      const d = kind === "color" ? colorDistance(va as string, vb as string) : Math.abs((va as number) - (vb as number));
      if (d > maxDifference) [maxDifference, at] = [d, simA2.samples[i].t];
    }
    const sa = simA2.summary[key];
    const sb = simB.summary[key];
    const settledAt: [number | undefined, number | undefined] = [sa.settledAt, sb.settledAt];
    const timeDiff = sa.settledAt !== undefined && sb.settledAt !== undefined ? Math.abs(sa.settledAt - sb.settledAt) : 0;
    const unit = kind === "color" ? "" : FRACTIONAL.has(prop) ? "" : " units";
    const fmtV = (v: number) => (FRACTIONAL.has(prop) ? v.toFixed(3) : v.toFixed(kind === "color" ? 1 : 2));

    let overshoot: [number, number] | undefined;
    if (kind !== "color") overshoot = [sa.overshoot ?? 0, sb.overshoot ?? 0];
    const sizeVerdict = grade(maxDifference, scale);
    const timeVerdict = grade(timeDiff, THRESHOLDS.time);
    const verdict = strongest(sizeVerdict, timeVerdict);

    const parts: string[] = [];
    if (maxDifference > 0) parts.push(`differs by up to ${fmtV(maxDifference)}${unit} at ${at.toFixed(2)}s (${sizeVerdict})`);
    else parts.push("identical");
    if (overshoot && fmtV(overshoot[0]) !== fmtV(overshoot[1])) parts.push(`overshoot ${fmtV(overshoot[0])} → ${fmtV(overshoot[1])}${unit}`);
    if (timeDiff > 0) parts.push(`at rest ${sa.settledAt!.toFixed(2)}s → ${sb.settledAt!.toFixed(2)}s (${timeVerdict})`);
    else if (settledAt[0] === undefined || settledAt[1] === undefined) parts.push(settledAt[0] === settledAt[1] ? "still moving in both" : `still moving in ${settledAt[0] === undefined ? "A" : "B"}`);
    properties.push({ property: key, maxDifference, at, overshoot, settledAt, verdict, summary: `${key}: ${parts.join("; ")}.` });
  }

  const verdict = properties.reduce<Perceptibility>((v, p) => strongest(v, p.verdict), "imperceptible");
  const changed = properties.filter((p) => p.maxDifference > 0 || (p.settledAt[0] ?? 0) !== (p.settledAt[1] ?? 0));
  const clear = properties.filter((p) => p.verdict === "clear");
  let headline: string;
  let suggestion: string | undefined;
  if (changed.length === 0) {
    headline = "A and B behave identically under these events.";
    suggestion = "If you changed something, it isn't reached by these events, or the change was undone. Check the diff of the two files.";
  } else if (verdict === "imperceptible") {
    headline = `Nothing a person will notice: ${describeLargest(changed)}, below what a display shows.`;
    suggestion = "To judge the direction, look at an exaggerated version first (about 3× the change), then dial it back.";
  } else if (verdict === "subtle") {
    headline = `A subtle change: ${describeLargest(changed)}. Look closely, side by side.`;
    suggestion = "If it doesn't read at a glance, try about 2× the change, then dial it back.";
  } else {
    headline = `A clear change: ${describeLargest(clear)}.`;
  }
  return { a: simA2, b: simB, properties, verdict, headline, suggestion, identical: changed.length === 0 };
}

/** The property that decides the verdict, as a clause: what moves differently and what settles later. */
function describeLargest(list: PropertyDifference[]): string {
  const top = [...list].sort((x, y) => rank(y) - rank(x))[0];
  const prop = top.property.split(".")[1];
  const unit = FRACTIONAL.has(prop) ? "" : " units";
  const parts: string[] = [];
  if (top.maxDifference > 0) parts.push(`${top.property} moves up to ${FRACTIONAL.has(prop) ? top.maxDifference.toFixed(3) : top.maxDifference.toFixed(1)}${unit} differently`);
  const [sa, sb] = top.settledAt;
  if (sa !== undefined && sb !== undefined && Math.abs(sa - sb) >= 0.005) parts.push(`settles ${(Math.abs(sb - sa)).toFixed(2)} s ${sb > sa ? "later" : "sooner"}`);
  else if ((sa === undefined) !== (sb === undefined)) parts.push(`${sa === undefined ? "A" : "B"} keeps moving`);
  // Only when the rounded figures differ, or the clause says "0.6 → 0.6".
  if (top.overshoot && Math.abs(top.overshoot[0] - top.overshoot[1]) >= (FRACTIONAL.has(prop) ? 0.01 : 0.1)) parts.push(`overshoot ${top.overshoot[0].toFixed(FRACTIONAL.has(prop) ? 3 : 1)} → ${top.overshoot[1].toFixed(FRACTIONAL.has(prop) ? 3 : 1)}${unit}`);
  return parts.join(", ") || `${top.property} changes`;
}

function rank(p: PropertyDifference): number {
  return p.verdict === "clear" ? 3 : p.verdict === "subtle" ? 2 : p.maxDifference > 0 ? 1 : 0;
}

function grade(value: number, scale: { imperceptible: number; subtle: number }): Perceptibility {
  return value < scale.imperceptible ? "imperceptible" : value < scale.subtle ? "subtle" : "clear";
}

function strongest(x: Perceptibility, y: Perceptibility): Perceptibility {
  const order: Perceptibility[] = ["imperceptible", "subtle", "clear"];
  return order[Math.max(order.indexOf(x), order.indexOf(y))];
}

function colorDistance(a: string, b: string): number {
  const [l1, a1, b1] = hexToOklab(a);
  const [l2, a2, b2] = hexToOklab(b);
  return 100 * Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

function lastTime(sim: Simulation): number {
  return sim.samples[sim.samples.length - 1].t;
}

/**
 * Frame times for A/B filmstrips: evenly spaced over the run, plus the moments that
 * matter (each event, shortly after it, and where each property differs most), so the
 * frames show what the verdict talks about. Returns the times and a caption per marked one.
 */
export function compareFrameTimes(c: Comparison, evenly = 6): { times: number[]; marks: Record<string, string> } {
  const until = Math.max(c.a.samples[c.a.samples.length - 1].t, c.b.samples[c.b.samples.length - 1].t);
  const times = new Set<number>();
  const marks: Record<string, string> = {};
  const add = (t: number, mark?: string) => {
    const r = Math.round(Math.max(0, Math.min(until, t)) * 1000) / 1000;
    times.add(r);
    if (mark && !marks[String(r)]) marks[String(r)] = mark;
  };
  for (let i = 0; i < evenly; i++) add((until * i) / Math.max(1, evenly - 1));
  for (const p of c.properties) {
    if (p.verdict === "imperceptible" || p.maxDifference === 0) continue;
    add(p.at, `${p.property} differs most`);
  }
  // Events: the moment itself and 80 ms after it, where a response is visible.
  for (const t of eventTimesOf(c)) {
    add(t);
    add(t + 0.08);
  }
  return { times: [...times].sort((x, y) => x - y), marks };
}

/** Times at which A's state changed: an event or a timer did something. */
function eventTimesOf(c: Comparison): number[] {
  const out: number[] = [];
  let last = c.a.samples[0]?.state.join("|");
  for (const s of c.a.samples) {
    const now = s.state.join("|");
    if (now !== last) out.push(s.t);
    last = now;
  }
  return out;
}

/** The format of a comparison bundle; native players read 1. */
export const COMPARE_BUNDLE_FORMAT = 1;

/**
 * A comparison for native players (`nudg compare --bundle`): both versions compiled, the
 * same events, and what the verdict says, so a SwiftUI or Compose view can play A and B
 * side by side on the app's own views and caption them with the headline.
 */
export function compareBundle(c: Comparison, a: Program, b: Program, options: SimulateOptions, labels: [string, string]): Record<string, unknown> {
  return {
    nudgCompare: COMPARE_BUNDLE_FORMAT,
    labels,
    headline: c.headline,
    ...(c.suggestion ? { suggestion: c.suggestion } : {}),
    properties: c.properties.map((p) => ({ property: p.property, verdict: p.verdict, summary: p.summary })),
    events: options.events.map((e) => ("event" in e ? { t: e.t, event: e.event } : { t: e.t, input: e.input, value: e.value })),
    ...(options.start ? { start: options.start } : {}),
    reducedMotion: options.reducedMotion === true,
    until: Math.max(c.a.samples[c.a.samples.length - 1].t, c.b.samples[c.b.samples.length - 1].t),
    a: programToJson(a),
    b: programToJson(b),
  };
}
