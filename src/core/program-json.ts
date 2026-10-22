// A compiled Program as plain JSON: what a runtime in another language reads, so only
// the reference implementation needs the validator. Everything is resolved (named
// motions, imports, spring forms, colors as OKLab channels), and every map is an array
// of entries, because order matters (regions, states) and not every JSON reader keeps
// object key order.

import type { EntryEffect, Follow, Loop, Machine, Measure, MeasuredEndpoint, Motion, Program, Property, State, Timer, Transition } from "./types.ts";

export const PROGRAM_FORMAT = 5;

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export function programToJson(program: Program): Json {
  return {
    nudgProgram: PROGRAM_FORMAT,
    version: program.version,
    targets: program.targets,
    properties: [...program.properties].map(([key, p]) => ({ key, ...property(p) })),
    animate: [...program.animate].map(([key, m]) => ({ key, motion: motion(m) })),
    machine: machine(program.machine),
  };
}

export function programFromJson(json: unknown): Program {
  const j = json as Record<string, any>;
  if (![1, 2, 3, 4, PROGRAM_FORMAT].includes(j?.nudgProgram)) throw new Error(`Not a compiled nudg program (formats 1 to ${PROGRAM_FORMAT}).`);
  return {
    version: j.version,
    targets: j.targets,
    properties: new Map(j.properties.map((p: any) => [p.key, readProperty(p)])),
    animate: new Map(j.animate.map((a: any) => [a.key, a.motion as Motion])),
    machine: readMachine(j.machine),
  };
}

function property(p: Property): Record<string, Json> {
  const out: Record<string, Json> = { kind: p.kind, base: p.base };
  if (p.map) out.map = { source: p.map.source, sourceKind: p.map.sourceKind, from: p.map.from.map(endpoint), to: p.map.to.map((value) => (Array.isArray(value) ? value : measure(value))) };
  if (p.measure) out.measure = measure(p.measure);
  if (p.min !== undefined) out.min = p.min;
  if (p.max !== undefined) out.max = p.max;
  return out;
}

function readProperty(p: any): Property {
  const out: Property = { kind: p.kind, base: p.base };
  if (p.map) out.map = { ...p.map, sourceKind: p.map.sourceKind ?? "property", from: p.map.from.map(readEndpoint), to: p.map.to.map((value: any) => (Array.isArray(value) ? value : readEndpoint(value))) };
  if (p.measure) out.measure = { ...p.measure, times: p.measure.times ?? 1, plus: p.measure.plus ?? 0 };
  if (p.min !== undefined) out.min = p.min;
  if (p.max !== undefined) out.max = p.max;
  return out;
}

const measure = (m: Measure): Json => ({ target: m.target, of: m.of, times: m.times, plus: m.plus });
const endpoint = (value: MeasuredEndpoint): Json => typeof value === "number" ? value : measure(value);
const readEndpoint = (value: any): MeasuredEndpoint => typeof value === "number" ? value : { target: value.target, of: value.of, times: value.times ?? 1, plus: value.plus ?? 0 };

function motion(m: Motion): Json {
  const out: Record<string, Json> =
    m.kind === "tween" ? { kind: "tween", duration: m.duration, ease: m.ease === "linear" ? "linear" : [...m.ease] } : { kind: "spring", stiffness: m.stiffness, damping: m.damping, mass: m.mass };
  if (m.kind === "spring" && m.kick !== undefined) out.kick = m.kick;
  if (m.delay !== undefined) out.delay = m.delay;
  return out;
}

function entryEffect(effect: EntryEffect): Json {
  if (effect.kind !== "keyframes") return motion(effect);
  return { kind: "keyframes", frames: effect.frames.map((frame) => ({ at: frame.at, value: frame.value })), duration: effect.duration, ease: effect.ease === "linear" ? "linear" : [...effect.ease] };
}

function readEntryEffect(effect: any): EntryEffect {
  return effect.kind === "keyframes"
    ? { kind: "keyframes", frames: effect.frames.map((frame: any) => ({ at: frame.at, value: frame.value })), duration: effect.duration, ease: effect.ease }
    : (effect as Motion & EntryEffect);
}

function machine(m: Machine): Json {
  if (m.kind === "regions") return { kind: "regions", regions: [...m.regions].map(([name, r]) => ({ name, machine: machine(r) })) };
  return { kind: "states", initial: m.initial, states: [...m.states.values()].map(state), when: [...m.when].map(([event, t]) => ({ event, ...transition(t) })) };
}

function readMachine(j: any): Machine {
  if (j.kind === "regions") return { kind: "regions", regions: new Map(j.regions.map((r: any) => [r.name, readMachine(r.machine)])) };
  return { kind: "states", initial: j.initial, states: new Map(j.states.map((s: any) => [s.name, readState(s)])), when: new Map(j.when.map((w: any) => [w.event, readTransition(w)])) };
}

function state(s: State): Json {
  const out: Record<string, Json> = {
    name: s.name,
    set: [...s.set].map(([key, value]) => ({ key, value })),
    measure: [...s.measure].map(([key, m]) => ({ key, ...(measure(m) as Record<string, Json>) })),
    follow: [...s.follow].map(([key, f]) => ({ key, ...follow(f) })),
    enter: [...s.enter].map(([key, effect]) => ({ key, effect: entryEffect(effect) })),
    loop: [...s.loop].map(([key, l]) => ({ key, ...loop(l) })),
    when: [...s.when].map(([event, t]) => ({ event, ...transition(t) })),
    timers: s.timers.map((t: Timer) => ({ key: t.key, delay: t.delay, pause: t.pause.map((p) => ({ ...p })), transition: transition(t.transition) })),
  };
  if (s.machine) out.machine = machine(s.machine);
  return out;
}

function readState(j: any): State {
  const s: State = {
    name: j.name,
    set: new Map(j.set.map((e: any) => [e.key, e.value])),
    measure: new Map(j.measure.map((e: any) => [e.key, { target: e.target, of: e.of, times: e.times ?? 1, plus: e.plus ?? 0 }])),
    follow: new Map(j.follow.map((e: any) => [e.key, readFollow(e)])),
    enter: new Map(j.enter.map((e: any) => [e.key, readEntryEffect(e.effect ?? e.motion)])),
    loop: new Map((j.loop ?? []).map((e: any) => [e.key, readLoop(e)])),
    when: new Map(j.when.map((w: any) => [w.event, readTransition(w)])),
    timers: j.timers.map((t: any) => ({ key: t.key, delay: t.delay, pause: (t.pause ?? []).map((p: any) => ({ on: p.on, off: p.off })), transition: readTransition(t.transition) })),
  };
  if (j.machine) s.machine = readMachine(j.machine);
  return s;
}

function loop(l: Loop): Record<string, Json> {
  const out: Record<string, Json> = { to: endpoint(l.to), frames: l.frames.map((frame) => ({ at: frame.at, value: endpoint(frame.value) })), duration: l.duration, ease: l.ease === "linear" ? "linear" : [...l.ease], delay: l.delay };
  if (l.wrap !== undefined) out.wrap = l.wrap;
  return out;
}

function readLoop(j: any): Loop {
  const l: Loop = { to: readEndpoint(j.to), frames: j.frames.map((frame: any) => ({ at: frame.at, value: readEndpoint(frame.value) })), duration: j.duration, ease: j.ease, delay: j.delay ?? 0 };
  if (j.wrap !== undefined) l.wrap = j.wrap;
  return l;
}

function follow(f: Follow): Record<string, Json> {
  const out: Record<string, Json> = { input: f.input, overdrag: f.overdrag };
  if (f.range) out.range = f.range.map(endpoint);
  return out;
}

function readFollow(j: any): Follow {
  const f: Follow = { input: j.input, overdrag: j.overdrag };
  if (j.range) f.range = [readEndpoint(j.range[0]), readEndpoint(j.range[1])];
  return f;
}

function transition(t: Transition): Record<string, Json> {
  const out: Record<string, Json> = { animate: [...t.animate].map(([key, m]) => ({ key, motion: motion(m) })) };
  if (t.to !== undefined) out.to = t.to;
  if (t.nearest) out.nearest = { states: t.nearest.states, by: t.nearest.by, momentum: t.nearest.momentum };
  if (t.step) out.step = [...t.step].map(([key, delta]) => ({ key, delta }));
  if (t.commit) out.commit = t.commit;
  return out;
}

function readTransition(j: any): Transition {
  const t: Transition = { animate: new Map(j.animate.map((a: any) => [a.key, a.motion as Motion])) };
  if (j.to !== undefined) t.to = j.to;
  if (j.nearest) t.nearest = j.nearest;
  if (j.step) t.step = new Map(j.step.map((s: any) => [s.key, s.delta]));
  if (j.commit) t.commit = j.commit;
  return t;
}
