// Runs a compiled Program. Time is always passed in, never read from a clock, so the
// same events at the same times always produce the same states and values.

import { oklabToHex } from "./color.ts";
import { easeAt, easeSlope } from "./ease.ts";
import { springAt } from "./spring.ts";
import type { Channels, Machine, Motion, Program, State, Transition } from "./types.ts";

export type Value = number | string;

export interface Runtime {
  readonly program: Program;
  /** Sends an event at time `t` (seconds). Returns false if nothing handled it. */
  send(event: string, t: number): boolean;
  /** Property values at time `t`: numbers in logical units, colors as hex. */
  sample(t: number): Record<string, Value>;
  /** Active leaf states as paths, e.g. ["on"] or ["checked/on", "press/up"]. */
  state(): string[];
  /** True when every property (or the given one) has come to rest at time `t`. */
  settled(t: number, property?: string): boolean;
}

/** A property's motion since its last change, evaluated in closed form. */
interface Segment {
  t0: number;
  from: Channels;
  v0: Channels;
  to: Channels;
  motion?: Motion;
}

/** Rest thresholds for `settled`, per channel. Advisory: values are never snapped. */
const REST = { number: 1e-3, color: 1e-4 };

export function createRuntime(program: Program): Runtime {
  const active = new Map<Machine, string>();
  const segments = new Map<string, Segment>();
  let now = 0;

  enterMachine(program.machine, []);
  for (const [key, to] of resolveTargets()) {
    segments.set(key, { t0: 0, from: to, v0: to.map(() => 0), to });
  }

  function enterMachine(machine: Machine, entered: State[]) {
    if (machine.kind === "states") enterState(machine, machine.initial, entered);
    else for (const region of machine.regions.values()) enterMachine(region, entered);
  }

  function enterState(machine: Machine & { kind: "states" }, name: string, entered: State[]) {
    active.set(machine, name);
    const state = machine.states.get(name)!;
    entered.push(state);
    if (state.machine) enterMachine(state.machine, entered);
  }

  function exitMachine(machine: Machine) {
    if (machine.kind === "regions") {
      for (const region of machine.regions.values()) exitMachine(region);
      return;
    }
    const state = machine.states.get(active.get(machine)!)!;
    if (state.machine) exitMachine(state.machine);
    active.delete(machine);
  }

  /** Innermost states get the event first; each parallel region gets its own chance. */
  function handle(machine: Machine, event: string, fired: Transition[], entered: State[]): boolean {
    if (machine.kind === "regions") {
      let handled = false;
      for (const region of machine.regions.values()) {
        if (handle(region, event, fired, entered)) handled = true;
      }
      return handled;
    }
    const state = machine.states.get(active.get(machine)!)!;
    if (state.machine && handle(state.machine, event, fired, entered)) return true;
    const transition = state.when.get(event);
    if (!transition) return false;
    exitMachine(machine);
    enterState(machine, transition.to, entered);
    fired.push(transition);
    return true;
  }

  /** Base values, overridden by every active state's `set`, deeper states last. */
  function resolveTargets(): Map<string, Channels> {
    const out = new Map<string, Channels>();
    for (const [key, prop] of program.properties) out.set(key, prop.base);
    const walk = (machine: Machine) => {
      if (machine.kind === "regions") {
        for (const region of machine.regions.values()) walk(region);
        return;
      }
      const state = machine.states.get(active.get(machine)!)!;
      for (const [key, value] of state.set) out.set(key, value);
      if (state.machine) walk(state.machine);
    };
    walk(program.machine);
    return out;
  }

  function advanceTo(t: number) {
    if (!Number.isFinite(t) || t < now) {
      throw new RangeError(`Time must not go backwards: got ${t}, already at ${now}.`);
    }
    now = t;
  }

  return {
    program,

    send(event, t) {
      advanceTo(t);
      const fired: Transition[] = [];
      const entered: State[] = [];
      if (!handle(program.machine, event, fired, entered)) return false;

      const overrides = new Map<string, Motion>();
      for (const transition of fired) for (const [key, motion] of transition.animate) overrides.set(key, motion);

      for (const [key, to] of resolveTargets()) {
        const segment = segments.get(key)!;
        if (sameChannels(segment.to, to)) continue;
        const [pos, vel] = evaluate(segment, t);
        segments.set(key, { t0: t, from: pos, v0: vel, to, motion: overrides.get(key) ?? program.animate.get(key) });
      }

      // Kicks keep the target and add velocity, then their own spring carries the value.
      for (const state of entered) {
        for (const [key, kick] of state.enter) {
          const segment = segments.get(key)!;
          const [pos, vel] = evaluate(segment, t);
          vel[0] += kick.kick ?? 0;
          segments.set(key, { t0: t, from: pos, v0: vel, to: segment.to, motion: kick });
        }
      }
      return true;
    },

    sample(t) {
      advanceTo(t);
      const out: Record<string, Value> = {};
      for (const [key, segment] of segments) {
        const [pos] = evaluate(segment, t);
        out[key] = program.properties.get(key)!.kind === "color" ? oklabToHex(pos) : pos[0];
      }
      return out;
    },

    state() {
      const out: string[] = [];
      const walk = (machine: Machine, prefix: string) => {
        if (machine.kind === "regions") {
          for (const [name, region] of machine.regions) walk(region, join(prefix, name));
          return;
        }
        const name = active.get(machine)!;
        const state = machine.states.get(name)!;
        if (state.machine) walk(state.machine, join(prefix, name));
        else out.push(join(prefix, name));
      };
      walk(program.machine, "");
      return out;
    },

    settled(t, property) {
      const keys = property === undefined ? [...segments.keys()] : [property];
      return keys.every((key) => {
        const segment = segments.get(key);
        if (!segment) throw new Error(`Unknown property "${key}".`);
        const motion = segment.motion;
        if (!motion) return true;
        if (motion.kind === "tween") return t - segment.t0 >= motion.duration;
        // Remaining amplitude from the spring's energy. Energy never increases, so once
        // a property is at rest it stays at rest until its target changes.
        const [pos, vel] = evaluate(segment, t);
        const eps = program.properties.get(key)!.kind === "color" ? REST.color : REST.number;
        const inertia = motion.mass / motion.stiffness;
        return pos.every((p, i) => Math.hypot(p - segment.to[i], vel[i] * Math.sqrt(inertia)) < eps);
      });
    },
  };
}

function evaluate(segment: Segment, t: number): [Channels, Channels] {
  const { motion, from, to, v0 } = segment;
  const dt = t - segment.t0;
  const zero = to.map(() => 0);
  if (!motion) return [to.slice(), zero];
  if (motion.kind === "tween") {
    if (dt >= motion.duration) return [to.slice(), zero];
    const u = dt / motion.duration;
    const progress = easeAt(motion.ease, u);
    const slope = easeSlope(motion.ease, u) / motion.duration;
    return [from.map((f, i) => f + (to[i] - f) * progress), from.map((f, i) => (to[i] - f) * slope)];
  }
  const pos: Channels = [];
  const vel: Channels = [];
  from.forEach((f, i) => {
    const [x, v] = springAt(motion, f - to[i], v0[i], dt);
    pos.push(to[i] + x);
    vel.push(v);
  });
  return [pos, vel];
}

function sameChannels(a: Channels, b: Channels): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function join(prefix: string, name: string): string {
  return prefix ? `${prefix}/${name}` : name;
}
