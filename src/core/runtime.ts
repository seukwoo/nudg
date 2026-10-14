// Runs a compiled Program. Time is always passed in, never read from a clock, so the
// same events and inputs at the same times always produce the same states and values.

import { oklabToHex } from "./color.ts";
import { easeAt, easeSlope } from "./ease.ts";
import { interpolate } from "./map.ts";
import { springAt } from "./spring.ts";
import type { Channels, Follow, Machine, Motion, Program, State, Transition } from "./types.ts";

export type Value = number | string;

export interface RuntimeOptions {
  /**
   * Leaf state paths to start in instead of `initial`, as `state()` reports them,
   * e.g. ["on"] or ["checked/on"]. Values start at those states' targets, at rest.
   */
  state?: string[];
}

export interface Runtime {
  readonly program: Program;
  /** Sends an event at time `t` (seconds). Returns false if nothing handled it. */
  send(event: string, t: number): boolean;
  /** Records an input sample at time `t`, e.g. ("track.drag.x", 12, 0.2). Returns false for an unknown input. */
  input(name: string, value: number, t: number): boolean;
  /** Property values at time `t`: numbers in logical units, colors as hex. */
  sample(t: number): Record<string, Value>;
  /** Active leaf states as paths, e.g. ["on"] or ["checked/on", "press/up"]. */
  state(): string[];
  /** True when every property (or the given one) has come to rest at time `t`. */
  settled(t: number, property?: string): boolean;
}

/** A property's behavior since its last change, evaluated in closed form. */
type Segment =
  | { kind: "motion"; t0: number; from: Channels; v0: Channels; to: Channels; motion?: Motion }
  | { kind: "follow"; t0: number; anchor: number; input0: number; follow: Follow; owner: State };

type StatesMachine = Machine & { kind: "states" };

/** Rest thresholds for `settled`, per channel. Advisory: values are never snapped. */
const REST = { number: 1e-3, color: 1e-4 };
/** Seconds of input history used for velocity. */
const VELOCITY_WINDOW = 0.1;
const INPUT = /^(.+)\.drag\.(x|y)$/;

export function createRuntime(program: Program, options: RuntimeOptions = {}): Runtime {
  const active = new Map<Machine, string>();
  const segments = new Map<string, Segment>();
  const inputs = new Map<string, [number, number][]>();
  let now = 0;

  enterMachine(program.machine, active, []);
  for (const path of options.state ?? []) enterPath(path);
  {
    const targets = resolveTargets(active);
    const follows = activeFollows(active);
    for (const [key, prop] of program.properties) {
      if (prop.map) continue;
      const to = targets.get(key)!;
      const f = follows.get(key);
      segments.set(key, f ? followSegment(f, to[0], 0) : { kind: "motion", t0: 0, from: to, v0: to.map(() => 0), to });
    }
  }

  function enterMachine(machine: Machine, act: Map<Machine, string>, entered: State[]) {
    if (machine.kind === "states") enterState(machine, machine.initial, act, entered);
    else for (const region of machine.regions.values()) enterMachine(region, act, entered);
  }

  function enterState(machine: StatesMachine, name: string, act: Map<Machine, string>, entered: State[]) {
    act.set(machine, name);
    const state = machine.states.get(name)!;
    entered.push(state);
    if (state.machine) enterMachine(state.machine, act, entered);
  }

  function exitMachine(machine: Machine, act: Map<Machine, string>) {
    if (machine.kind === "regions") {
      for (const region of machine.regions.values()) exitMachine(region, act);
      return;
    }
    const state = machine.states.get(act.get(machine)!)!;
    if (state.machine) exitMachine(state.machine, act);
    act.delete(machine);
  }

  function enterPath(path: string) {
    const parts = path.split("/");
    let machine: Machine = program.machine;
    for (let i = 0; i < parts.length; i++) {
      if (machine.kind === "regions") {
        const region = machine.regions.get(parts[i]);
        if (!region) throw new Error(`No region "${parts[i]}" in state path "${path}".`);
        machine = region;
        continue;
      }
      const state = machine.states.get(parts[i]);
      if (!state) throw new Error(`No state "${parts[i]}" in state path "${path}".`);
      if (active.get(machine) !== parts[i]) {
        exitMachine(machine, active);
        enterState(machine, parts[i], active, []);
      }
      if (i < parts.length - 1) {
        if (!state.machine) throw new Error(`State "${parts[i]}" has no states inside it, in state path "${path}".`);
        machine = state.machine;
      }
    }
  }

  /** Walks the active states, outer before inner, regions in file order. */
  function walkActive(act: Map<Machine, string>, visit: (state: State) => void) {
    const walk = (machine: Machine) => {
      if (machine.kind === "regions") {
        for (const region of machine.regions.values()) walk(region);
        return;
      }
      const state = machine.states.get(act.get(machine)!)!;
      visit(state);
      if (state.machine) walk(state.machine);
    };
    walk(program.machine);
  }

  /** Base values, overridden by every active state's `set`, deeper states last. */
  function resolveTargets(act: Map<Machine, string>): Map<string, Channels> {
    const out = new Map<string, Channels>();
    for (const [key, prop] of program.properties) if (!prop.map) out.set(key, prop.base);
    walkActive(act, (state) => {
      for (const [key, value] of state.set) out.set(key, value);
    });
    return out;
  }

  function activeFollows(act: Map<Machine, string>): Map<string, { follow: Follow; owner: State }> {
    const out = new Map<string, { follow: Follow; owner: State }>();
    walkActive(act, (state) => {
      for (const [key, follow] of state.follow) out.set(key, { follow, owner: state });
    });
    return out;
  }

  function followSegment(f: { follow: Follow; owner: State }, anchor: number, t: number): Segment {
    return { kind: "follow", t0: t, anchor, input0: inputAt(f.follow.input, t), follow: f.follow, owner: f.owner };
  }

  function inputAt(name: string, t: number): number {
    const history = inputs.get(name);
    if (!history) return 0;
    let value = 0;
    for (const [ti, v] of history) {
      if (ti > t) break;
      value = v;
    }
    return value;
  }

  /** Least-squares slope over the window before `t`; 0 with fewer than two samples. */
  function velocityAt(name: string, t: number): number {
    const points = (inputs.get(name) ?? []).filter(([ti]) => ti >= t - VELOCITY_WINDOW - 1e-9 && ti <= t + 1e-9);
    if (points.length < 2) return 0;
    const mt = points.reduce((a, [ti]) => a + ti, 0) / points.length;
    const mv = points.reduce((a, [, v]) => a + v, 0) / points.length;
    let num = 0;
    let den = 0;
    for (const [ti, v] of points) {
      num += (ti - mt) * (v - mv);
      den += (ti - mt) ** 2;
    }
    return den === 0 ? 0 : num / den;
  }

  function evaluate(segment: Segment, t: number): [Channels, Channels] {
    if (segment.kind === "follow") {
      const { anchor, input0, follow } = segment;
      const raw = anchor + inputAt(follow.input, t) - input0;
      let value = raw;
      let factor = 1;
      if (follow.range) {
        const [lo, hi] = follow.range;
        if (raw < lo) [value, factor] = [lo - (lo - raw) * follow.overdrag, follow.overdrag];
        else if (raw > hi) [value, factor] = [hi + (raw - hi) * follow.overdrag, follow.overdrag];
      }
      return [[value], [velocityAt(follow.input, t) * factor]];
    }
    return evaluateMotion(segment, t);
  }

  /** Picks the candidate whose target for `by` is closest to where `by` was heading. */
  function nearest(machine: StatesMachine, choice: NonNullable<Transition["nearest"]>, t: number): string {
    const [pos, vel] = evaluate(segments.get(choice.by)!, t);
    const projected = pos[0] + vel[0] * choice.momentum;
    let best = choice.states[0];
    let bestDistance = Infinity;
    for (const name of choice.states) {
      const hypothetical = new Map(active);
      exitMachine(machine, hypothetical);
      enterState(machine, name, hypothetical, []);
      const distance = Math.abs(projected - resolveTargets(hypothetical).get(choice.by)![0]);
      if (distance < bestDistance) [best, bestDistance] = [name, distance];
    }
    return best;
  }

  /** Innermost states get the event first; then the machine's own `when`; each region separately. */
  function handle(machine: Machine, event: string, t: number, fired: Transition[], entered: State[]): boolean {
    if (machine.kind === "regions") {
      let handled = false;
      for (const region of machine.regions.values()) {
        if (handle(region, event, t, fired, entered)) handled = true;
      }
      return handled;
    }
    const state = machine.states.get(active.get(machine)!)!;
    if (state.machine && handle(state.machine, event, t, fired, entered)) return true;
    const transition = state.when.get(event) ?? machine.when.get(event);
    if (!transition) return false;
    const target = transition.to ?? nearest(machine, transition.nearest!, t);
    exitMachine(machine, active);
    enterState(machine, target, active, entered);
    fired.push(transition);
    return true;
  }

  function advanceTo(t: number) {
    if (!Number.isFinite(t) || t < now) {
      throw new RangeError(`Time must not go backwards: got ${t}, already at ${now}.`);
    }
    now = t;
  }

  const valueOf = (key: string, t: number): Channels => {
    const prop = program.properties.get(key)!;
    if (prop.map) return interpolate(prop.map, evaluate(segments.get(prop.map.source)!, t)[0][0]);
    return evaluate(segments.get(key)!, t)[0];
  };

  return {
    program,

    send(event, t) {
      advanceTo(t);
      const dot = event.indexOf(".");
      if (event.slice(dot + 1) === "dragstart") {
        // A drag's inputs count from 0 at dragstart (the host reports travel since down).
        for (const axis of ["x", "y"]) inputs.set(`${event.slice(0, dot)}.drag.${axis}`, [[t, 0]]);
      }
      const fired: Transition[] = [];
      const entered: State[] = [];
      if (!handle(program.machine, event, t, fired, entered)) return false;

      const overrides = new Map<string, Motion>();
      for (const transition of fired) for (const [key, motion] of transition.animate) overrides.set(key, motion);
      const targets = resolveTargets(active);
      const follows = activeFollows(active);

      for (const [key, prop] of program.properties) {
        if (prop.map) continue;
        const segment = segments.get(key)!;
        const f = follows.get(key);
        if (f) {
          // Start following from wherever the value is now, so there's no jump.
          if (segment.kind !== "follow" || segment.owner !== f.owner || entered.includes(f.owner)) {
            segments.set(key, followSegment(f, evaluate(segment, t)[0][0], t));
          }
          continue;
        }
        const to = targets.get(key)!;
        // Leaving a follow always hands off, carrying the input's velocity into the motion.
        if (segment.kind === "motion" && sameChannels(segment.to, to)) continue;
        const [pos, vel] = evaluate(segment, t);
        segments.set(key, { kind: "motion", t0: t, from: pos, v0: vel, to, motion: overrides.get(key) ?? program.animate.get(key) });
      }

      // Kicks keep the target and add velocity, then their own spring carries the value.
      for (const state of entered) {
        for (const [key, kick] of state.enter) {
          const segment = segments.get(key)!;
          if (segment.kind === "follow") continue;
          const [pos, vel] = evaluate(segment, t);
          vel[0] += kick.kick ?? 0;
          segments.set(key, { kind: "motion", t0: t, from: pos, v0: vel, to: segment.to, motion: kick });
        }
      }
      return true;
    },

    input(name, value, t) {
      advanceTo(t);
      const m = INPUT.exec(name);
      if (!m || !program.targets.includes(m[1]) || !Number.isFinite(value)) return false;
      const history = inputs.get(name) ?? [];
      history.push([t, value]);
      inputs.set(name, history);
      return true;
    },

    sample(t) {
      advanceTo(t);
      const out: Record<string, Value> = {};
      for (const [key, prop] of program.properties) {
        const channels = valueOf(key, t);
        out[key] = prop.kind === "color" ? oklabToHex(channels) : channels[0];
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
      const keys = property === undefined ? [...program.properties.keys()] : [property];
      return keys.every((key) => {
        const prop = program.properties.get(key);
        if (!prop) throw new Error(`Unknown property "${key}".`);
        const source = prop.map ? prop.map.source : key;
        const segment = segments.get(source)!;
        // A followed value moves only when its input does; nothing is animating it.
        if (segment.kind === "follow" || !segment.motion) return true;
        const motion = segment.motion;
        if (motion.kind === "tween") return t - segment.t0 >= motion.duration;
        // Remaining amplitude from the spring's energy. Energy never increases, so once
        // a property is at rest it stays at rest until its target changes.
        const [pos, vel] = evaluateMotion(segment, t);
        const eps = program.properties.get(source)!.kind === "color" ? REST.color : REST.number;
        const inertia = motion.mass / motion.stiffness;
        return pos.every((p, i) => Math.hypot(p - segment.to[i], vel[i] * Math.sqrt(inertia)) < eps);
      });
    },
  };
}

function evaluateMotion(segment: Segment & { kind: "motion" }, t: number): [Channels, Channels] {
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
