// The documents presets make, turned into programs without the compiler. A web app that
// compiles its files at build time (the Vite plugin) still builds presets in the browser,
// and the compiler with every message and hint is most of nudg's weight there. Presets use
// a small, fixed part of the format, already known to be valid, so this reads that part
// and nothing else: anything outside it returns undefined and the caller says what to do.
// A test checks that it gives exactly what the compiler gives, for every preset option.

import { hexToOklab } from "./color.ts";
import { fromDurationBounce } from "./spring.ts";
import { NAMED_EASES, PROPERTIES } from "./vocabulary.ts";
import type { Channels, Machine, Motion, Program, Property, State, Timer, Transition } from "./types.ts";

type Json = Record<string, unknown>;

const TOP = new Set(["nudg", "note", "targets", "values", "animate", "initial", "states", "when"]);
const STATE = new Set(["set", "when"]);

/** The program for a document in the presets' part of the format, or undefined. */
export function lowerSimple(doc: object): Program | undefined {
  const d = doc as Json;
  if (Object.keys(d).some((k) => !TOP.has(k)) || typeof d.nudg !== "string" || !Array.isArray(d.targets) || typeof d.initial !== "string") return undefined;
  const properties = new Map<string, Property>();
  for (const [key, value] of Object.entries((d.values as Json) ?? {})) {
    const kind = PROPERTIES[key.split(".")[1]];
    const base = channels(kind, value);
    if (!kind || !base) return undefined;
    properties.set(key, { kind, base });
  }
  const animate = motions(d.animate);
  const states = new Map<string, State>();
  for (const [name, raw] of Object.entries((d.states as Json) ?? {})) {
    const state = lowerState(name, raw as Json, properties);
    if (!state) return undefined;
    states.set(name, state);
  }
  const when = transitions(d.when);
  if (!animate || !when || when.timers.length || !states.has(d.initial)) return undefined;
  const machine: Machine = { kind: "states", initial: d.initial, states, when: when.map };
  return { version: d.nudg, targets: d.targets as string[], properties, animate, machine };
}

function lowerState(name: string, raw: Json, properties: Map<string, Property>): State | undefined {
  if (typeof raw !== "object" || raw === null || Object.keys(raw).some((k) => !STATE.has(k))) return undefined;
  const set = new Map<string, Channels>();
  for (const [key, value] of Object.entries((raw.set as Json) ?? {})) {
    const c = channels(properties.get(key)?.kind, value);
    if (!c) return undefined;
    set.set(key, c);
  }
  const when = transitions(raw.when);
  if (!when) return undefined;
  const empty = () => new Map();
  return { name, set, measure: empty(), input: empty(), follow: empty(), glide: empty(), enter: empty(), loop: empty(), when: when.map, timers: when.timers };
}

function channels(kind: string | undefined, value: unknown): Channels | undefined {
  if (kind === "color") return typeof value === "string" && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value) ? hexToOklab(value) : undefined;
  return kind && typeof value === "number" && Number.isFinite(value) ? [value] : undefined;
}

function motions(raw: unknown): Map<string, Motion> | undefined {
  const out = new Map<string, Motion>();
  for (const [key, m] of Object.entries((raw as Json) ?? {})) {
    const motion = lowerMotion(m as Json);
    if (!motion) return undefined;
    out.set(key, motion);
  }
  return out;
}

function lowerMotion(m: Json): Motion | undefined {
  const keys = Object.keys(m ?? {});
  if (keys.length !== 1) return undefined;
  const spring = m.spring as Json | undefined;
  if (spring && Object.keys(spring).every((k) => k === "duration" || k === "bounce") && typeof spring.duration === "number" && spring.duration > 0) {
    const bounce = spring.bounce ?? 0;
    if (typeof bounce !== "number" || !(bounce < 1)) return undefined;
    return { kind: "spring", ...fromDurationBounce(spring.duration, bounce) };
  }
  const tween = m.tween as Json | undefined;
  if (tween && Object.keys(tween).every((k) => k === "duration" || k === "ease") && typeof tween.duration === "number" && tween.duration >= 0) {
    const ease = NAMED_EASES[(tween.ease as string) ?? "in-out"];
    return ease ? { kind: "tween", duration: tween.duration, ease } : undefined;
  }
  return undefined;
}

function transitions(raw: unknown): { map: Map<string, Transition>; timers: Timer[] } | undefined {
  const map = new Map<string, Transition>();
  const timers: Timer[] = [];
  for (const [event, value] of Object.entries((raw as Json) ?? {})) {
    let transition: Transition | undefined;
    if (typeof value === "string") transition = { to: value, animate: new Map() };
    else if (typeof value === "object" && value !== null && Object.keys(value).every((k) => k === "to" || k === "animate") && typeof (value as Json).to === "string") {
      const animate = motions((value as Json).animate);
      if (animate) transition = { to: (value as Json).to as string, animate };
    }
    if (!transition) return undefined;
    if (event.startsWith("after:")) {
      const m = /^after:(\d+\.?\d*|\.\d+)(ms|s)$/.exec(event);
      if (!m) return undefined;
      timers.push({ key: event, delay: m[2] === "ms" ? Number(m[1]) / 1000 : Number(m[1]), transition, pause: [] });
    } else map.set(event, transition);
  }
  return { map, timers };
}
