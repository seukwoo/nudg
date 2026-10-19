// Runs a compiled Program. Time is always passed in, never read from a clock, so the
// same events and inputs at the same times always produce the same states and values.

import { oklabToHex } from "./color.ts";
import { easeAt, easeSlope } from "./ease.ts";
import { interpolate } from "./map.ts";
import { springAt } from "./spring.ts";
import type { Channels, Follow, Machine, Measure, Motion, Program, State, Transition } from "./types.ts";

export type Value = number | string;

export interface RuntimeOptions {
  /**
   * Leaf state paths to start in instead of `initial`, as `state()` reports them,
   * e.g. ["on"] or ["checked/on"]. Values start at those states' targets, at rest.
   */
  state?: string[];
  /**
   * Reduced motion (v0.3): every spring and tween becomes a short linear tween and
   * kicks do nothing. States, timers and followed values are unchanged.
   */
  reducedMotion?: boolean;
}

export interface Runtime {
  readonly program: Program;
  /** Sends an event at time `t` (seconds). Returns false if nothing handled it. */
  send(event: string, t: number): boolean;
  /** Records a referenced drag, app, scroll, or layout input sample at time `t`. */
  input(name: string, value: number, t: number): boolean;
  /** Continuous inputs referenced by `map` or `follow` (layout measurements excluded). */
  requiredInputs(): string[];
  /** The layout inputs this program reads (target.layout.<name>), for a host to report. */
  measurements(): string[];
  /** Of those, the ones not reported yet: measured values fall back to their base until then. */
  unmeasured(): string[];
  /** Property values at time `t`: numbers in logical units, colors as hex. */
  sample(t: number): Record<string, Value>;
  /**
   * Where each property is heading right now (its resolved target), or undefined while
   * it follows an input or is mapped. Changes only when an event or timer fires.
   */
  targets(): Record<string, Value | undefined>;
  /** Active leaf states as paths, e.g. ["on"] or ["checked/on", "press/up"]. */
  state(): string[];
  /** True when every property (or the given one) has come to rest at time `t` and no timer is pending. */
  settled(t: number, property?: string): boolean;
}

/** A property's behavior since its last change, evaluated in closed form. */
type Segment =
  | { kind: "motion"; t0: number; from: Channels; v0: Channels; to: Channels; motion?: Motion }
  | { kind: "follow"; t0: number; anchor: number; input0: number; follow: Follow; owner: State };

type StatesMachine = Machine & { kind: "states" };

/** A timer set when its state was entered. `order` keeps file order among equal due times. */
interface Pending {
  due: number;
  order: number;
  machine: StatesMachine;
  state: State;
  transition: Transition;
}

/** Rest thresholds for `settled`, per channel. Advisory: values are never snapped. */
const REST = { number: 1e-3, color: 1e-4 };
/** Seconds of input history used for velocity. */
const VELOCITY_WINDOW = 0.1;
const LAYOUT = /^(.+)\.layout\.(x|y|width|height|naturalWidth|naturalHeight)$/;
/** What every motion becomes under reduced motion. */
const REDUCED: Motion = { kind: "tween", duration: 0.15, ease: "linear" };

export function createRuntime(program: Program, options: RuntimeOptions = {}): Runtime {
  const active = new Map<Machine, string>();
  const segments = new Map<string, Segment>();
  const inputs = new Map<string, [number, number][]>();
  /** Base values, which `step` and `commit` change for good. */
  const bases = new Map<string, Channels>();
  const pending: Pending[] = [];
  /** The host's latest layout report, by input name (v0.4). */
  const layout = new Map<string, number>();
  /** Base values measured from layout, until a step or commit replaces them. */
  const measuredBases = new Map<string, Measure>();
  for (const [key, prop] of program.properties) if (prop.measure) measuredBases.set(key, prop.measure);
  const requiredInputs = new Set<string>();
  for (const prop of program.properties.values()) if (prop.map?.sourceKind === "input") requiredInputs.add(prop.map.source);
  collectFollowInputs(program.machine, requiredInputs);
  let order = 0;
  let now = 0;
  const reduced = options.reducedMotion === true;

  for (const [key, prop] of program.properties) if (!prop.map) bases.set(key, prop.base);
  enterMachine(program.machine, active, [], 0);
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

  function enterMachine(machine: Machine, act: Map<Machine, string>, entered: State[], t: number) {
    if (machine.kind === "states") enterState(machine, machine.initial, act, entered, t);
    else for (const region of machine.regions.values()) enterMachine(region, act, entered, t);
  }

  function enterState(machine: StatesMachine, name: string, act: Map<Machine, string>, entered: State[], t: number) {
    act.set(machine, name);
    const state = machine.states.get(name)!;
    entered.push(state);
    if (act === active) for (const timer of state.timers) pending.push({ due: t + timer.delay, order: order++, machine, state, transition: timer.transition });
    if (state.machine) enterMachine(state.machine, act, entered, t);
  }

  function exitMachine(machine: Machine, act: Map<Machine, string>) {
    if (machine.kind === "regions") {
      for (const region of machine.regions.values()) exitMachine(region, act);
      return;
    }
    const state = machine.states.get(act.get(machine)!)!;
    if (state.machine) exitMachine(state.machine, act);
    if (act === active) {
      for (let i = pending.length - 1; i >= 0; i--) if (pending[i].state === state) pending.splice(i, 1);
    }
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
        enterState(machine, parts[i], active, [], 0);
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

  /** The layout inputs a measurement reads: positions align, so they also need the property's own target. */
  function inputsOf(key: string, m: Measure): string[] {
    const own = key.split(".")[0];
    return m.of === "x" || m.of === "y" ? [`${m.target}.layout.${m.of}`, `${own}.layout.${m.of}`] : [`${m.target}.layout.${m.of}`];
  }

  /** A measured value from the latest report, or undefined until everything it reads is reported. */
  function measured(key: string, m: Measure): number | undefined {
    const values = inputsOf(key, m).map((name) => layout.get(name));
    if (values.some((v) => v === undefined)) return undefined;
    const value = m.of === "x" || m.of === "y" ? values[0]! - values[1]! : values[0]!;
    return value * m.times + m.plus;
  }

  /** Base values (measured ones from the layout report), overridden by every active state's `set`, deeper states last. */
  function resolveTargets(act: Map<Machine, string>): Map<string, Channels> {
    const out = new Map<string, Channels>(bases);
    for (const [key, m] of measuredBases) {
      const v = measured(key, m);
      if (v !== undefined) out.set(key, [clamp(key, v)]);
    }
    const resolvedBases = new Map(out);
    walkActive(act, (state) => {
      for (const [key, value] of state.set) {
        const m = state.measure.get(key);
        if (!m) {
          out.set(key, value);
          continue;
        }
        // Not measured yet: the property's base value.
        const v = measured(key, m);
        out.set(key, v === undefined ? resolvedBases.get(key)! : [clamp(key, v)]);
      }
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

  function clamp(key: string, value: number): number {
    const prop = program.properties.get(key)!;
    if (prop.min !== undefined && value < prop.min) return prop.min;
    if (prop.max !== undefined && value > prop.max) return prop.max;
    return value;
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
      enterState(machine, name, hypothetical, [], t);
      const distance = Math.abs(projected - resolveTargets(hypothetical).get(choice.by)![0]);
      if (distance < bestDistance) [best, bestDistance] = [name, distance];
    }
    return best;
  }

  /** Performs a transition from `state` in `machine` at time `t`. */
  function perform(machine: StatesMachine, transition: Transition, t: number, fired: Transition[], entered: State[]) {
    fired.push(transition);
    if (transition.to === undefined && !transition.nearest) return; // step or commit only: stay
    const target = transition.to ?? nearest(machine, transition.nearest!, t);
    exitMachine(machine, active);
    enterState(machine, target, active, entered, t);
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
    perform(machine, transition, t, fired, entered);
    return true;
  }

  /**
   * After the machine or the layout changed at time `t`: commit and step bases, then
   * retarget every property. `snap` places changed targets without motion: a layout
   * reported for the first time is where things are, not somewhere they move to.
   */
  function settle(t: number, fired: Transition[], entered: State[], snap = false) {
    const committed = new Set<string>();
    for (const transition of fired) {
      for (const key of transition.commit ?? []) {
        bases.set(key, [clamp(key, evaluate(segments.get(key)!, t)[0][0])]);
        measuredBases.delete(key);
        committed.add(key);
      }
      for (const [key, delta] of transition.step ?? []) {
        // A step moves from the base as it resolves now, measured or not; from then on it's a number.
        const m = measuredBases.get(key);
        const from = (m && measured(key, m)) ?? bases.get(key)![0];
        bases.set(key, [clamp(key, from + delta)]);
        measuredBases.delete(key);
      }
    }
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
      if (snap) {
        segments.set(key, { kind: "motion", t0: t, from: to, v0: to.map(() => 0), to });
        continue;
      }
      const [pos, vel] = evaluate(segment, t);
      // A committed value is placed, not thrown: it keeps no velocity from the finger.
      if (committed.has(key)) vel.fill(0);
      const motion = overrides.get(key) ?? program.animate.get(key);
      segments.set(key, { kind: "motion", t0: t, from: pos, v0: vel, to, motion: motion && reduced ? REDUCED : motion });
    }

    // Kicks keep the target and add velocity, then their own spring carries the value.
    if (reduced) return;
    for (const state of entered) {
      for (const [key, kick] of state.enter) {
        const segment = segments.get(key)!;
        if (segment.kind === "follow") continue;
        const [pos, vel] = evaluate(segment, t);
        vel[0] += kick.kick ?? 0;
        segments.set(key, { kind: "motion", t0: t, from: pos, v0: vel, to: segment.to, motion: kick });
      }
    }
  }

  /** Fires every timer due by `t`, earliest first, each at its own due time. */
  function fireDue(t: number) {
    for (;;) {
      let next: Pending | undefined;
      for (const p of pending) if (p.due <= t + 1e-9 && (!next || p.due < next.due || (p.due === next.due && p.order < next.order))) next = p;
      if (!next) return;
      pending.splice(pending.indexOf(next), 1);
      const fired: Transition[] = [];
      const entered: State[] = [];
      perform(next.machine, next.transition, next.due, fired, entered);
      settle(next.due, fired, entered);
    }
  }

  function advanceTo(t: number) {
    if (!Number.isFinite(t) || t < now) {
      throw new RangeError(`Time must not go backwards: got ${t}, already at ${now}.`);
    }
    now = t;
    fireDue(t);
  }

  const valueOf = (key: string, t: number): Channels => {
    const prop = program.properties.get(key)!;
    if (prop.map) {
      const source = prop.map.sourceKind === "input" ? inputAt(prop.map.source, t) : evaluate(segments.get(prop.map.source)!, t)[0][0];
      return interpolate(prop.map, source);
    }
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
      settle(t, fired, entered);
      return true;
    },

    input(name, value, t) {
      advanceTo(t);
      const l = LAYOUT.exec(name);
      if (l) {
        if (!program.targets.includes(l[1]) || !Number.isFinite(value)) return false;
        const first = !layout.has(name);
        if (layout.get(name) === value) return true;
        layout.set(name, value);
        // A relayout moves measured values to their new targets, with each property's motion.
        settle(t, [], [], first);
        return true;
      }
      if (!requiredInputs.has(name) || !Number.isFinite(value)) return false;
      const history = inputs.get(name) ?? [];
      history.push([t, value]);
      inputs.set(name, history);
      return true;
    },

    requiredInputs() {
      return [...requiredInputs];
    },

    measurements() {
      const out = new Set<string>();
      for (const [key, m] of measuredBases) for (const name of inputsOf(key, m)) out.add(name);
      const walk = (machine: Machine) => {
        if (machine.kind === "regions") {
          for (const region of machine.regions.values()) walk(region);
          return;
        }
        for (const state of machine.states.values()) {
          for (const [key, m] of state.measure) for (const name of inputsOf(key, m)) out.add(name);
          if (state.machine) walk(state.machine);
        }
      };
      walk(program.machine);
      return [...out];
    },

    unmeasured() {
      return this.measurements().filter((name) => !layout.has(name));
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

    targets() {
      const out: Record<string, Value | undefined> = {};
      const resolved = resolveTargets(active);
      for (const [key, prop] of program.properties) {
        const segment = segments.get(key);
        if (prop.map || !segment || segment.kind === "follow") {
          out[key] = undefined;
          continue;
        }
        const to = resolved.get(key)!;
        out[key] = prop.kind === "color" ? oklabToHex(to) : to[0];
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
      advanceTo(t);
      if (property === undefined && pending.length) return false;
      const keys = property === undefined ? [...program.properties.keys()] : [property];
      return keys.every((key) => {
        const prop = program.properties.get(key);
        if (!prop) throw new Error(`Unknown property "${key}".`);
        if (prop.map?.sourceKind === "input") return true;
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

function collectFollowInputs(machine: Machine, out: Set<string>) {
  if (machine.kind === "regions") {
    for (const region of machine.regions.values()) collectFollowInputs(region, out);
    return;
  }
  for (const state of machine.states.values()) {
    for (const follow of state.follow.values()) out.add(follow.input);
    if (state.machine) collectFollowInputs(state.machine, out);
  }
}

function sameChannels(a: Channels, b: Channels): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function join(prefix: string, name: string): string {
  return prefix ? `${prefix}/${name}` : name;
}
