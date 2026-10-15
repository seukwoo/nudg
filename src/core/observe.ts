// Host truth. A file says what should happen; this judges what a running page actually
// showed: a time series measured on the real element (its transform, opacity, size, and
// whether it was still there), summarized the way `simulate` summarizes a file, and
// held against the file's own prediction under the same events.

import { THRESHOLDS, type Perceptibility } from "./compare.ts";
import type { PropertySummary, Simulation } from "./simulate.ts";
import type { Machine, Program } from "./types.ts";

/** What the host reports per frame. `present` is false once the element left the page. */
export interface HostSample {
  t: number;
  present: boolean;
  /** Logical-unit values by abstract property name (x, y, scale, rotation, opacity, width, height). */
  values: Record<string, number>;
}

export interface HostMark {
  t: number;
  /** The action that was performed on the page, e.g. "down", "up", "tap", "hover". */
  action: string;
}

export interface HostSeries {
  samples: HostSample[];
  marks: HostMark[];
  /** When the element left the page, if it did. */
  unmountedAt?: number;
  /** When a different element took the selector's place, if that happened. */
  remountedAt?: number;
}

export interface HostSummary {
  /** Per measured property: what the page did. Properties that never changed are listed in `still`. */
  properties: Record<string, PropertySummary & { changed: boolean }>;
  still: string[];
  unmountedAt?: number;
  remountedAt?: number;
  /** Sample spacing actually achieved, for the reader's sense of resolution. */
  frameInterval: number;
  /** When the observation ended (the last sample). */
  until: number;
}

/** A value is at rest once it stays within this of its final value: the runtime's own rest threshold, above the page's 0.001 rounding. */
const REST = 0.002;
/** Below this range a property counts as never having moved (a device pixel; a hundredth of scale or opacity... halved). */
const CHANGE = { position: 0.5, fraction: 0.005 };
const FRACTIONAL = new Set(["scale", "scaleX", "scaleY", "opacity"]);

/**
 * The file events that the page's actions stand for, at the times the actions actually
 * happened, so the file can be simulated under what the page went through. A tap is a
 * down, an up and a tap; hover and leave are hoverstart and hoverend; key:x is key.x.
 */
export function actionsToEvents(targetOf: string | ((action: string) => string), marks: HostMark[]): { t: number; event: string }[] {
  const out: { t: number; event: string }[] = [];
  for (const m of marks) {
    const a = m.action;
    const target = typeof targetOf === "function" ? targetOf(a) : targetOf;
    if (a === "down") out.push({ t: m.t, event: `${target}.down` });
    else if (a === "up") out.push({ t: m.t, event: `${target}.up` }, { t: m.t, event: `${target}.tap` });
    else if (a === "tap") out.push({ t: m.t, event: `${target}.down` }, { t: m.t, event: `${target}.up` }, { t: m.t, event: `${target}.tap` });
    else if (a === "hover") out.push({ t: m.t, event: `${target}.hoverstart` });
    else if (a === "leave") out.push({ t: m.t, event: `${target}.hoverend` });
    else if (a.startsWith("key:")) out.push({ t: m.t, event: `${target}.key.${a.slice(4) === " " ? "space" : a.slice(4).toLowerCase()}` });
  }
  return out;
}

/** Every event name the program handles, in any state. */
export function handledEvents(program: Program): Set<string> {
  const out = new Set<string>();
  const walk = (machine: Machine) => {
    if (machine.kind === "regions") {
      for (const region of machine.regions.values()) walk(region);
      return;
    }
    for (const key of machine.when.keys()) out.add(key);
    for (const state of machine.states.values()) {
      for (const key of state.when.keys()) out.add(key);
      if (state.machine) walk(state.machine);
    }
  };
  walk(program.machine);
  return out;
}

/** The file events a page action stands for, without the target. */
function eventsForAction(action: string): string[] {
  if (action === "down" || action === "up" || action === "tap") return ["down", "up", "tap"];
  if (action === "hover") return ["hoverstart"];
  if (action === "leave") return ["hoverend"];
  if (action.startsWith("key:")) return [`key.${action.slice(4) === " " ? "space" : action.slice(4).toLowerCase()}`];
  return [];
}

/**
 * Which target an action is for: the first target (in file order) that handles any of
 * the events the action produces. In a toggle the knob moves but the track is tapped;
 * the file says so, and this reads it. Falls back to the first property's target.
 */
export function actionTarget(program: Program, action: string): string {
  const handled = handledEvents(program);
  const wanted = eventsForAction(action);
  for (const target of program.targets) if (wanted.some((e) => handled.has(`${target}.${e}`))) return target;
  return [...program.properties.keys()][0]?.split(".")[0] ?? program.targets[0];
}

/** Summarizes what the page did with each property, in the same terms as a file's simulation. */
export function summarizeHost(series: HostSeries): HostSummary {
  const present = series.samples.filter((s) => s.present);
  const keys = new Set<string>();
  for (const s of present) for (const k of Object.keys(s.values)) keys.add(k);
  const properties: HostSummary["properties"] = {};
  const still: string[] = [];
  for (const key of keys) {
    const points = present.filter((s) => key in s.values).map((s) => [s.t, s.values[key]] as const);
    if (points.length === 0) continue;
    const vals = points.map((p) => p[1]);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const final = vals[vals.length - 1];
    const rest = REST;
    const changed = max - min > (FRACTIONAL.has(key) ? CHANGE.fraction : CHANGE.position);
    // Settled: from the last moment the value was farther than `rest` from where it ended.
    let settledAt: number | undefined = points[0][0];
    for (const [, v] of points) if (Math.abs(v - final) > rest) settledAt = undefined;
    if (settledAt === undefined) {
      for (let i = points.length - 1; i >= 0; i--) {
        if (Math.abs(points[i][1] - final) > rest) {
          settledAt = points[i + 1]?.[0];
          break;
        }
      }
    }
    // The page was still moving if the last few frames weren't at rest.
    const tail = points.slice(-4);
    const moving = tail.length > 1 && Math.max(...tail.map((p) => p[1])) - Math.min(...tail.map((p) => p[1])) > rest;
    const summary: PropertySummary & { changed: boolean } = { final, min, max, overshoot: overshootOf(points, rest, series.marks.map((m) => m.t)), changed };
    if (!moving && settledAt !== undefined) summary.settledAt = settledAt;
    properties[key] = summary;
    if (!changed) still.push(key);
  }
  const ts = present.map((s) => s.t);
  const frameInterval = ts.length > 1 ? (ts[ts.length - 1] - ts[0]) / (ts.length - 1) : 0;
  const out: HostSummary = { properties, still, frameInterval, until: ts.length ? ts[ts.length - 1] : 0 };
  if (series.unmountedAt !== undefined) out.unmountedAt = series.unmountedAt;
  if (series.remountedAt !== undefined) out.remountedAt = series.remountedAt;
  return out;
}

/**
 * Overshoot without knowing the targets: the series is cut into legs at every action and
 * at every plateau (a value held still for 100 ms), and each leg's overshoot is how far
 * the value went past the leg's destination in its direction of travel. A press
 * 1 → 0.9 (held) → 1 has none; a release that passes 1 and peaks at 1.01 overshoots 0.01.
 * A leg that ends where it began (a tap whose spring never rests midway) reports 0,
 * since the turning point can't be told from the target.
 */
function overshootOf(points: readonly (readonly [number, number])[], rest: number, cuts: number[]): number {
  const anchors: number[] = [0];
  // Plateaus: runs of at least 100 ms within `rest` of their first value.
  let runStart = 0;
  for (let i = 1; i <= points.length; i++) {
    const inRun = i < points.length && Math.abs(points[i][1] - points[runStart][1]) <= rest;
    if (inRun) continue;
    if (points[i - 1][0] - points[runStart][0] >= 0.1 && runStart > 0) anchors.push(runStart, i - 1);
    runStart = i;
  }
  for (const t of cuts) {
    const i = points.findIndex((p) => p[0] >= t);
    // An action lands on a resting value most of the time; one that lands mid-motion
    // (a release on the bounce) doesn't start a new leg, or the bounce would be cut in two.
    if (i > 0 && Math.abs(points[i][1] - points[i - 1][1]) <= rest) anchors.push(i);
  }
  anchors.push(points.length - 1);
  const order = [...new Set(anchors)].sort((a, b) => a - b);
  let best = 0;
  for (let k = 0; k + 1 < order.length; k++) {
    const [from, to] = [order[k], order[k + 1]];
    const dir = Math.sign(points[to][1] - points[from][1]);
    if (dir === 0) continue;
    for (let i = from + 1; i <= to; i++) {
      const past = dir * (points[i][1] - points[to][1]);
      if (past > best) best = past;
    }
  }
  return best > rest ? best : 0;
}

/**
 * Settle times on a page are fuzzier than in a file: frames land every 16 ms, and the
 * last fraction of a percent of a spring is invisible, so the page and the file call
 * "at rest" at slightly different moments. Wider than `compare`'s time thresholds.
 */
const HOST_TIME = { imperceptible: 0.1, subtle: 0.25 };

export interface HostJudgement {
  verdict: "played" | "differs" | "never-shown" | "nothing-moved" | "unmeasured";
  headline: string;
  /** Per file property that the page could measure. */
  properties: { property: string; measured: string; summary: string; verdict: Perceptibility }[];
  suggestion?: string;
}

/** Maps a file property (`button.scale`) to what the page measures (`scale`). */
export function measuredName(property: string): string | undefined {
  const name = property.split(".").slice(1).join(".");
  return ["x", "y", "scale", "scaleX", "scaleY", "rotation", "opacity", "width", "height"].includes(name) ? name : undefined;
}

/**
 * Holds the page against the file: did the page show what the file plays under the same
 * events? `file` is the file's simulation; `host` the page's summary for the file's one
 * target. Perceptibility uses the same thresholds as `compare`.
 */
export function judgeHost(file: Simulation, host: HostSummary, options: { target?: string } = {}): HostJudgement {
  const properties: HostJudgement["properties"] = [];
  const fileKeys = Object.keys(file.summary).filter((k) => !options.target || k.startsWith(options.target + "."));
  let worst: Perceptibility = "imperceptible";
  const fileMoved = fileKeys.filter((k) => {
    const s = file.summary[k];
    return s.min !== undefined && s.max !== undefined && s.max - s.min > 0;
  });
  for (const key of fileKeys) {
    const measured = measuredName(key);
    if (!measured) continue;
    const f = file.summary[key];
    const h = host.properties[measured];
    if (f.min === undefined || f.max === undefined) continue;
    if (!h) {
      properties.push({ property: key, measured, summary: `${key}: the page doesn't expose ${measured}.`, verdict: "imperceptible" });
      continue;
    }
    const prop = key.split(".")[1];
    const scale = FRACTIONAL.has(prop) ? THRESHOLDS.fraction : THRESHOLDS.position;
    const fmtV = (v: number) => (FRACTIONAL.has(prop) ? v.toFixed(3) : v.toFixed(1));
    const extent = Math.max(Math.abs(f.min - h.min!), Math.abs(f.max - h.max!));
    // A page still moving after the file came to rest is late by at least the rest of the observation.
    const timeDiff = f.settledAt !== undefined && h.settledAt !== undefined ? Math.abs(f.settledAt - h.settledAt) : f.settledAt !== undefined && h.settledAt === undefined ? Math.max(0, host.until - f.settledAt) : 0;
    const sizeVerdict = grade(extent, scale);
    const timeVerdict = grade(timeDiff, HOST_TIME);
    const verdict = strongest(sizeVerdict, timeVerdict);
    const parts: string[] = [];
    if (f.max - f.min > 0 && !h.changed) parts.push(`file moves ${fmtV(f.min)} → ${fmtV(f.max)}, page never moved`);
    else {
      parts.push(`range ${fmtV(f.min)}…${fmtV(f.max)} → page ${fmtV(h.min!)}…${fmtV(h.max!)}${extent > 0 ? ` (${sizeVerdict})` : ""}`);
      if (f.settledAt !== undefined && h.settledAt !== undefined && timeDiff > 0) parts.push(`at rest ${f.settledAt.toFixed(2)}s → page ${h.settledAt.toFixed(2)}s (${timeVerdict})`);
      else if (h.settledAt === undefined) parts.push(`page still moving at the end${f.settledAt !== undefined ? `, file at rest from ${f.settledAt.toFixed(2)}s (${timeVerdict})` : ""}`);
      if ((f.overshoot ?? 0) >= 0.5 * (FRACTIONAL.has(prop) ? 0.01 : 1) || (h.overshoot ?? 0) >= 0.5 * (FRACTIONAL.has(prop) ? 0.01 : 1)) parts.push(`overshoot ${fmtV(f.overshoot ?? 0)} → page ${fmtV(h.overshoot ?? 0)}`);
    }
    const v: Perceptibility = f.max - f.min > 0 && !h.changed ? "clear" : verdict;
    worst = strongest(worst, v);
    properties.push({ property: key, measured, summary: `${key}: ${parts.join("; ")}.`, verdict: v });
  }

  const measurable = properties.filter((p) => !p.summary.includes("doesn't expose"));
  if (measurable.length === 0) {
    const exposes = Object.keys(host.properties).filter((k) => k !== "scaleX" && k !== "scaleY");
    return {
      verdict: "unmeasured",
      headline: `Nothing of ${options.target ?? "the file"} could be measured: the file animates ${fileKeys.join(", ") || "nothing"}; the page exposes ${exposes.join(", ") || "nothing"}.`,
      properties,
      suggestion: "Check the target name and the selector; colors can't be measured yet.",
    };
  }

  // An exit that was allowed to finish is fine; one cut short is the classic "never shown".
  const fileSettle = Math.max(...fileKeys.map((k) => file.summary[k].settledAt ?? Infinity), 0);
  const cutShort = host.unmountedAt !== undefined && (host.unmountedAt < fileSettle - 0.05 || Object.values(host.properties).some((p) => p.changed && (p.settledAt === undefined || p.settledAt > host.unmountedAt!)));
  const leftAfter = host.unmountedAt !== undefined && !cutShort ? ` The element left the page at ${host.unmountedAt.toFixed(2)}s, after the motion had settled.` : "";
  if (cutShort) {
    const when = host.unmountedAt!.toFixed(2);
    const movedBefore = Object.values(host.properties).some((p) => p.changed);
    return {
      verdict: "never-shown",
      headline: movedBefore
        ? `The element left the page at ${when}s, mid-motion: what the file plays after that is never shown.`
        : `The element left the page at ${when}s before anything moved: the file's motion is never shown.`,
      properties,
      suggestion: "Keep the element mounted until its motion settles (the adapter's onState or settled, or a host-side exit state), or move the motion to an element that stays.",
    };
  }
  const anyPageMotion = Object.values(host.properties).some((p) => p.changed);
  if (fileMoved.length > 0 && !anyPageMotion) {
    return {
      verdict: "nothing-moved",
      headline: `Nothing moved on the page: the file plays ${fileMoved.join(", ")}, the element's ${Object.keys(host.properties).join(", ")} stayed put.`,
      properties,
      suggestion: "Check that the element is bound (data-nudg or bind), that the page runs this file, and that the actions reach it (another element may be on top).",
    };
  }
  if (worst === "imperceptible") {
    return { verdict: "played", headline: `The page plays what the file says: no difference a person would see.${leftAfter}`, properties };
  }
  const top = [...properties].sort((a, b) => rank(b.verdict) - rank(a.verdict))[0];
  return {
    verdict: "differs",
    headline: `The page differs from the file (${worst}): ${top.summary.replace(/\.$/, "")}.${leftAfter}`,
    properties,
    suggestion: worst === "clear" ? "Something on the page overrides or delays the motion: a CSS transition on the same property, a re-render that resets the element, or a stale build of the file." : undefined,
  };
}

function rank(v: Perceptibility): number {
  return v === "clear" ? 2 : v === "subtle" ? 1 : 0;
}

function grade(value: number, scale: { imperceptible: number; subtle: number }): Perceptibility {
  return value < scale.imperceptible ? "imperceptible" : value < scale.subtle ? "subtle" : "clear";
}

function strongest(x: Perceptibility, y: Perceptibility): Perceptibility {
  return rank(x) >= rank(y) ? x : y;
}

/** Decomposes a 2D CSS matrix (a, b, c, d, e, f) into translate, scale and rotation (degrees). */
export function decomposeMatrix(m: [number, number, number, number, number, number]): { x: number; y: number; scaleX: number; scaleY: number; rotation: number } {
  const [a, b, c, d, e, f] = m;
  const scaleX = Math.hypot(a, b);
  const rotation = (Math.atan2(b, a) * 180) / Math.PI;
  // Remove the rotation from the second column to read the y scale.
  const cos = Math.cos((rotation * Math.PI) / 180);
  const sin = Math.sin((rotation * Math.PI) / 180);
  const scaleY = d * cos - c * sin;
  return { x: e, y: f, scaleX, scaleY, rotation };
}
