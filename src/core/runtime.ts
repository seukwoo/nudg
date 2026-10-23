// Runs a compiled Program. Time is always passed in, never read from a clock, so the
// same events and inputs at the same times always produce the same states and values.

import { oklabToHex } from "./color.ts";
import { easeAt, easeSlope } from "./ease.ts";
import { interpolate } from "./map.ts";
import { springAt } from "./spring.ts";
import { CROSSING, DOUBLE_TAP, LONG_PRESS, SCROLL_SLOP } from "./vocabulary.ts";

/** Where a pinch's inputs start (v0.18): the ratio at 1, rotation and travel at 0. */
const PINCH_START: [string, number][] = [["scale", 1], ["rotation", 0], ["x", 0], ["y", 0]];
import type { Channels, Follow, Glide, Loop, Machine, Measure, MeasuredEndpoint, Motion, Program, PropertyMap, State, TimerPause, Transition } from "./types.ts";

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
  /** True when every property (or the given one) has come to rest at time `t` and no timer or long press is pending. */
  settled(t: number, property?: string): boolean;
  /** True when every property has come to rest at time `t`, whatever timers are pending: nothing is moving. */
  resting(t: number): boolean;
  /** The latest time the runtime has been advanced to by an event, input or sample. */
  time(): number;
  /** True while an active state loops a property (v0.10): values change every frame though nothing is settling. */
  looping(): boolean;
}

/** A property's behavior since its last change, evaluated in closed form. */
type Segment =
  | { kind: "motion"; t0: number; from: Channels; v0: Channels; to: Channels; motion?: Motion }
  | { kind: "keyframes"; t0: number; from: Channels; to: Channels; frames: { at: number; value: Channels }[]; duration: number; ease: import("./types.ts").Ease; owner: State }
  | { kind: "follow"; key: string; t0: number; anchor: number; input0: number; follow: Follow; owner: State }
  /** A property slowing down from `v0` (v0.16), and settling at a range bound if it reaches one. */
  | { kind: "glide"; key: string; t0: number; x0: number; v0: number; glide: Glide; owner: State }
  /** A motion that starts at `t0` (v0.12); until then the property does what `prev` does. */
  | { kind: "delayed"; t0: number; prev: Segment; to: Channels; motion: Motion; started?: Segment & { kind: "motion" } };

type StatesMachine = Machine & { kind: "states" };

/** A timer set when its state was entered. `order` keeps file order among equal due times. */
interface Pending {
  due: number;
  order: number;
  machine: StatesMachine;
  state: State;
  transition: Transition;
  pause: TimerPause[];
  blockers: Set<number>;
  pausedAt?: number;
}

/** Rest thresholds for `settled`, per channel. Advisory: values are never snapped. */
const REST = { number: 1e-3, color: 1e-4 };
/** Seconds of input history used for velocity. */
const VELOCITY_WINDOW = 0.1;
const LAYOUT = /^(.+)\.layout\.(x|y|width|height|naturalWidth|naturalHeight)$/;
/** A loop running since its state was entered at `t0`. */
interface ActiveLoop {
  loop: Loop;
  owner: State;
  t0: number;
}

/** What every motion becomes under reduced motion. */
const REDUCED: Motion = { kind: "tween", duration: 0.15, ease: "linear" };

export function createRuntime(program: Program, options: RuntimeOptions = {}): Runtime {
  const active = new Map<Machine, string>();
  const segments = new Map<string, Segment>();
  /** Loops of the active states, by property (v0.10). Empty under reduced motion. */
  const loops = new Map<string, ActiveLoop>();
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
  /** Inputs that states read as targets (v0.17): a new sample retargets, like a relayout. */
  const targetInputs = new Set<string>();
  collectTargetInputs(program.machine, targetInputs);
  for (const name of targetInputs) requiredInputs.add(name);
  let order = 0;
  let now = 0;
  const reduced = options.reducedMotion === true;
  // Gestures derived from down, up and tap (v0.14), only for targets whose events the file handles.
  const wants = handledEventNames(program.machine);
  /** When each pressed target becomes a long press, until up, cancel or dragstart. */
  const pressDue = new Map<string, number>();
  /** Targets whose current press was a long press: the tap that ends it is not a tap. */
  const longPressed = new Set<string>();
  const lastTap = new Map<string, number>();
  // Events derived from inputs (v0.15): crossings in event-name order, and scroll directions.
  const crossings = [...wants]
    .sort()
    .flatMap((event) => {
      const m = CROSSING.exec(event);
      return m ? [{ event, input: m[1], above: m[2] === ">", value: Number(m[3]) }] : [];
    })
    .map((c) => ({ ...c, inside: c.above ? 0 > c.value : 0 < c.value }));
  for (const c of crossings) requiredInputs.add(c.input);
  /** Per scrolled axis: the direction last reported and the furthest point in it. */
  const scrolls = new Map<string, { back: string; forth: string; dir?: "back" | "forth"; ref: number }>();
  for (const [axis, back, forth] of [["y", "scrollup", "scrolldown"], ["x", "scrollleft", "scrollright"]]) {
    for (const event of wants) {
      const [target, name] = event.split(".");
      if (name !== back && name !== forth) continue;
      const input = `${target}.scroll.${axis}`;
      requiredInputs.add(input);
      scrolls.set(input, { back: `${target}.${back}`, forth: `${target}.${forth}`, ref: 0 });
    }
  }

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
      segments.set(key, f ? followSegment(key, f, to[0], 0) : { kind: "motion", t0: 0, from: to, v0: to.map(() => 0), to });
    }
    if (!reduced) walkActive(active, (state) => {
      for (const [key, loop] of state.loop) loops.set(key, { loop, owner: state, t0: 0 });
    });
  }

  function enterMachine(machine: Machine, act: Map<Machine, string>, entered: State[], t: number) {
    if (machine.kind === "states") enterState(machine, machine.initial, act, entered, t);
    else for (const region of machine.regions.values()) enterMachine(region, act, entered, t);
  }

  function enterState(machine: StatesMachine, name: string, act: Map<Machine, string>, entered: State[], t: number) {
    act.set(machine, name);
    const state = machine.states.get(name)!;
    entered.push(state);
    if (act === active) for (const timer of state.timers) pending.push({ due: t + timer.delay, order: order++, machine, state, transition: timer.transition, pause: timer.pause, blockers: new Set() });
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

  const endpoint = (key: string, value: MeasuredEndpoint): number | undefined => typeof value === "number" ? value : measured(key, value);

  function resolvedRange(key: string, range: Follow["range"]): [number, number] | undefined {
    if (!range) return undefined;
    const a = endpoint(key, range[0]);
    const b = endpoint(key, range[1]);
    if (a === undefined || b === undefined || a === b) return undefined;
    return [Math.min(a, b), Math.max(a, b)];
  }

  function resolvedMap(key: string, map: PropertyMap): { from: number[]; to: Channels[] } | undefined {
    const context = map.sourceKind === "property" ? map.source : key;
    const from = map.from.map((point) => endpoint(context, point));
    if (from.some((point) => point === undefined)) return undefined;
    const numbers = from as number[];
    if (new Set(numbers).size !== numbers.length) return undefined;
    // Measured values resolve in the mapped property's own coordinates (v0.11).
    const to: Channels[] = [];
    for (const value of map.to) {
      if (Array.isArray(value)) {
        to.push(value);
        continue;
      }
      const v = measured(key, value);
      if (v === undefined) return undefined;
      to.push([v]);
    }
    return { from: numbers, to };
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
        const target = state.input.get(key);
        if (target) {
          // The input's latest sample (0 before the first), scaled and offset.
          const history = inputs.get(target.input);
          out.set(key, [clamp(key, (history ? history[history.length - 1][1] : 0) * target.times + target.plus)]);
          continue;
        }
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

  function activeGlides(act: Map<Machine, string>): Map<string, { glide: Glide; owner: State }> {
    const out = new Map<string, { glide: Glide; owner: State }>();
    walkActive(act, (state) => {
      for (const [key, glide] of state.glide) out.set(key, { glide, owner: state });
    });
    return out;
  }

  /**
   * Where a glide is at `t`: x0 + v0·m·(1 − e^(−t/m)), so it travels v0·m in all. If that
   * would pass a range bound, it reaches the bound and settles there with the property's own
   * motion, keeping the speed it had; one that starts outside the range goes straight back.
   */
  function glideState(segment: Segment & { kind: "glide" }, t: number): { motion: Segment & { kind: "motion" } } | { pos: number; vel: number } {
    const { x0, v0, glide, key, t0 } = segment;
    const m = glide.momentum;
    const range = resolvedRange(key, glide.range);
    const motion = program.animate.get(key);
    const settleAt = (start: number, from: number, v: number, bound: number) => ({ motion: { kind: "motion" as const, t0: start, from: [from], v0: [v], to: [bound], motion: motion && reduced ? REDUCED : motion } });
    if (range && (x0 < range[0] || x0 > range[1])) return settleAt(t0, x0, v0, x0 < range[0] ? range[0] : range[1]);
    const end = x0 + v0 * m;
    if (range && (end < range[0] || end > range[1])) {
      const bound = end < range[0] ? range[0] : range[1];
      const hit = -m * Math.log(1 - (bound - x0) / (v0 * m));
      if (t - t0 >= hit) return settleAt(t0 + hit, bound, v0 * Math.exp(-hit / m), bound);
    }
    const e = Math.exp(-(t - t0) / m);
    return { pos: x0 + v0 * m * (1 - e), vel: v0 * e };
  }

  function activeFollows(act: Map<Machine, string>): Map<string, { follow: Follow; owner: State }> {
    const out = new Map<string, { follow: Follow; owner: State }>();
    walkActive(act, (state) => {
      for (const [key, follow] of state.follow) out.set(key, { follow, owner: state });
    });
    return out;
  }

  function followSegment(key: string, f: { follow: Follow; owner: State }, anchor: number, t: number): Segment {
    return { kind: "follow", key, t0: t, anchor, input0: inputAt(f.follow.input, t), follow: f.follow, owner: f.owner };
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
      const { key, anchor, input0, follow } = segment;
      // A multiplying follow scales by the input's ratio since entry (a pinch); otherwise it adds the change.
      // From an input at 0 there is no ratio, so it holds.
      const gain = !follow.multiply ? 1 : input0 === 0 ? 0 : anchor / input0;
      const raw = follow.multiply ? (input0 === 0 ? anchor : inputAt(follow.input, t) * gain) : anchor + inputAt(follow.input, t) - input0;
      let value = raw;
      let factor = 1;
      const range = resolvedRange(key, follow.range);
      if (range) {
        const [lo, hi] = range;
        if (raw < lo) [value, factor] = [lo - (lo - raw) * follow.overdrag, follow.overdrag];
        else if (raw > hi) [value, factor] = [hi + (raw - hi) * follow.overdrag, follow.overdrag];
      }
      return [[value], [velocityAt(follow.input, t) * factor * gain]];
    }
    if (segment.kind === "keyframes") return evaluateKeyframes(segment, t);
    if (segment.kind === "glide") {
      const s = glideState(segment, t);
      return "motion" in s ? evaluateMotion(s.motion, t) : [[s.pos], [s.vel]];
    }
    if (segment.kind === "delayed") return t < segment.t0 ? evaluate(segment.prev, t) : evaluateMotion(started(segment), t);
    return evaluateMotion(segment, t);
  }

  /** The motion a delayed segment becomes: from wherever `prev` is when the delay ends. */
  function started(segment: Segment & { kind: "delayed" }): Segment & { kind: "motion" } {
    if (!segment.started) {
      const [from, v0] = evaluate(segment.prev, segment.t0);
      segment.started = { kind: "motion", t0: segment.t0, from, v0, to: segment.to, motion: segment.motion };
    }
    return segment.started;
  }

  /** A loop's offset and its rate at `t`; 0 before its delay, and while a measured point is unknown. */
  function loopOffset(key: string, active: ActiveLoop, t: number): [number, number] {
    const { loop } = active;
    const local = t - active.t0 - loop.delay;
    if (local < 0) return [0, 0];
    const points: { at: number; value: number }[] = [{ at: 0, value: 0 }];
    for (const frame of [...loop.frames, { at: 1, value: loop.to }]) {
      const value = endpoint(key, frame.value);
      if (value === undefined) return [0, 0];
      points.push({ at: frame.at, value });
    }
    const u = (local - loop.duration * Math.floor(local / loop.duration)) / loop.duration;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      if (u > b.at) continue;
      const local = (u - a.at) / (b.at - a.at);
      return [a.value + (b.value - a.value) * easeAt(loop.ease, local), ((b.value - a.value) * easeSlope(loop.ease, local)) / ((b.at - a.at) * loop.duration)];
    }
    return [points[points.length - 1].value, 0];
  }

  /** What a property shows: its motion, plus the offset of a running loop. */
  function displayed(key: string, t: number): [Channels, Channels] {
    const [pos, vel] = evaluate(segments.get(key)!, t);
    const running = loops.get(key);
    if (!running) return [pos, vel];
    const [offset, rate] = loopOffset(key, running, t);
    return [[pos[0] + offset], [vel[0] + rate]];
  }

  function clamp(key: string, value: number): number {
    const prop = program.properties.get(key)!;
    if (prop.min !== undefined && value < prop.min) return prop.min;
    if (prop.max !== undefined && value > prop.max) return prop.max;
    return value;
  }

  /** Picks the candidate whose target for `by` is closest to where `by` was heading. */
  function nearest(machine: StatesMachine, choice: NonNullable<Transition["nearest"]>, t: number): string {
    const [pos, vel] = displayed(choice.by, t);
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
        bases.set(key, [clamp(key, displayed(key, t)[0][0])]);
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
    const glides = activeGlides(active);
    const activeStates = new Set<State>();
    walkActive(active, (state) => activeStates.add(state));

    // A loop that ends hands off like a released drag: the motion continues from the
    // displayed value with the loop's velocity, its offset first reduced by `wrap`.
    const handoff = new Map<string, [Channels, Channels]>();
    for (const [key, running] of loops) {
      if (activeStates.has(running.owner) && !entered.includes(running.owner)) continue;
      const [pos, vel] = evaluate(segments.get(key)!, t);
      let [offset, rate] = loopOffset(key, running, t);
      const wrap = running.loop.wrap;
      // Into (-wrap/2, wrap/2]: the same rule in every runtime, whatever its rounding.
      if (wrap !== undefined) offset -= wrap * Math.ceil(offset / wrap - 0.5);
      handoff.set(key, [[pos[0] + offset], [vel[0] + rate]]);
      loops.delete(key);
    }
    if (!reduced) {
      for (const state of activeStates) {
        if (!entered.includes(state)) continue;
        for (const [key, loop] of state.loop) loops.set(key, { loop, owner: state, t0: t });
      }
    }

    for (const [key, prop] of program.properties) {
      if (prop.map) continue;
      const segment = segments.get(key)!;
      const f = follows.get(key);
      if (f) {
        // Start following from wherever the value is now, so there's no jump.
        if (segment.kind !== "follow" || segment.owner !== f.owner || entered.includes(f.owner) || handoff.has(key)) {
          segments.set(key, followSegment(key, f, (handoff.get(key) ?? evaluate(segment, t))[0][0], t));
        }
        continue;
      }
      const g = glides.get(key);
      if (g) {
        // Glide on from wherever the value is, with the velocity it has.
        if (segment.kind !== "glide" || segment.owner !== g.owner || entered.includes(g.owner) || handoff.has(key)) {
          const [pos, vel] = handoff.get(key) ?? evaluate(segment, t);
          segments.set(key, { kind: "glide", key, t0: t, x0: pos[0], v0: committed.has(key) ? 0 : vel[0], glide: g.glide, owner: g.owner });
        }
        continue;
      }
      const to = targets.get(key)!;
      if (segment.kind === "keyframes" && activeStates.has(segment.owner) && !entered.includes(segment.owner) && !handoff.has(key)) {
        segment.to = to;
        continue;
      }
      // Leaving a follow always hands off, carrying the input's velocity into the motion.
      if ((segment.kind === "motion" || segment.kind === "delayed") && sameChannels(segment.to, to) && !handoff.has(key)) continue;
      if (snap) {
        segments.set(key, { kind: "motion", t0: t, from: to, v0: to.map(() => 0), to });
        continue;
      }
      const [pos, vel] = handoff.get(key) ?? evaluate(segment, t);
      // A committed value is placed, not thrown: it keeps no velocity from the finger.
      if (committed.has(key)) vel.fill(0);
      const motion = overrides.get(key) ?? program.animate.get(key);
      if (motion?.delay && !reduced) {
        // Until the delay ends the property keeps doing what it was doing: a pending
        // motion that hasn't started is dropped, and a value placed here holds still.
        const placed = handoff.has(key) || committed.has(key);
        const prev: Segment = placed ? { kind: "motion", t0: t, from: pos, v0: vel.map(() => 0), to: pos } : segment.kind === "delayed" && t < segment.t0 ? segment.prev : segment;
        segments.set(key, { kind: "delayed", t0: t + motion.delay, prev, to, motion });
        continue;
      }
      segments.set(key, { kind: "motion", t0: t, from: pos, v0: vel, to, motion: motion && reduced ? REDUCED : motion });
    }

    // Entry effects are transient: kicks add velocity; keyframes travel through authored
    // intermediate values from the exact current position back to the state target.
    if (reduced) return;
    for (const state of entered) {
      for (const [key, effect] of state.enter) {
        const segment = segments.get(key)!;
        if (segment.kind === "follow" || segment.kind === "glide") continue;
        const [pos, vel] = evaluate(segment, t);
        if (effect.kind === "keyframes") {
          segments.set(key, { kind: "keyframes", t0: t, from: pos, to: segment.to, frames: effect.frames, duration: effect.duration, ease: effect.ease, owner: state });
        } else {
          vel[0] += effect.kick ?? 0;
          segments.set(key, { kind: "motion", t0: t, from: pos, v0: vel, to: segment.to, motion: effect });
        }
      }
    }
  }

  /** Fires every timer due by `t`, earliest first, each at its own due time. */
  /** Fires every timer and long press due by `t`, earliest first; a timer before a long press due at the same time. */
  function fireDue(t: number) {
    for (;;) {
      let next: Pending | undefined;
      for (const p of pending) if (p.pausedAt === undefined && p.due <= t + 1e-9 && (!next || p.due < next.due || (p.due === next.due && p.order < next.order))) next = p;
      let press: [string, number] | undefined;
      for (const [target, due] of pressDue) if (due <= t + 1e-9 && (!press || due < press[1])) press = [target, due];
      if (press && (!next || press[1] < next.due)) {
        pressDue.delete(press[0]);
        longPressed.add(press[0]);
        dispatch(`${press[0]}.longpress`, press[1]);
        continue;
      }
      if (!next) return;
      pending.splice(pending.indexOf(next), 1);
      const fired: Transition[] = [];
      const entered: State[] = [];
      perform(next.machine, next.transition, next.due, fired, entered);
      settle(next.due, fired, entered);
    }
  }

  /** Delivers one event at `t`: pause reasons first, then the machine. False if nothing handled it. */
  function dispatch(event: string, t: number): boolean {
    const fired: Transition[] = [];
    const entered: State[] = [];
    const timerHandled = controlTimers(event, t);
    if (!handle(program.machine, event, t, fired, entered)) return timerHandled;
    settle(t, fired, entered);
    return true;
  }

  /** Applies all pause reasons owned by timers that were active when this event arrived. */
  function controlTimers(event: string, t: number): boolean {
    let handled = false;
    for (const timer of pending) {
      timer.pause.forEach((pair, i) => {
        if (event === pair.on) {
          handled = true;
          if (timer.blockers.has(i)) return;
          if (timer.blockers.size === 0) timer.pausedAt = t;
          timer.blockers.add(i);
        } else if (event === pair.off) {
          handled = true;
          if (!timer.blockers.delete(i) || timer.blockers.size !== 0) return;
          timer.due += t - timer.pausedAt!;
          timer.pausedAt = undefined;
        }
      });
    }
    return handled;
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
      const map = resolvedMap(key, prop.map);
      if (!map) return prop.base;
      const source = prop.map.sourceKind === "input" ? inputAt(prop.map.source, t) : displayed(prop.map.source, t)[0][0];
      return interpolate(map, source);
    }
    return displayed(key, t)[0];
  };

  return {
    program,

    send(event, t) {
      advanceTo(t);
      const dot = event.indexOf(".");
      const target = event.slice(0, dot);
      const name = event.slice(dot + 1);
      if (name === "dragstart") {
        // A drag's inputs count from 0 at dragstart (the host reports travel since down).
        for (const axis of ["x", "y"]) inputs.set(`${target}.drag.${axis}`, [[t, 0]]);
        for (const c of crossings) if (c.input.startsWith(`${target}.drag.`)) c.inside = c.above ? 0 > c.value : 0 < c.value;
      }
      if (name === "pinchstart") {
        // A pinch's inputs start over: ratio 1, rotation and travel 0.
        for (const [input, start] of PINCH_START) inputs.set(`${target}.pinch.${input}`, [[t, start]]);
        for (const c of crossings) {
          const start = PINCH_START.find(([input]) => c.input === `${target}.pinch.${input}`)?.[1];
          if (start !== undefined) c.inside = c.above ? start > c.value : start < c.value;
        }
      }
      if (name === "down" && wants.has(`${target}.longpress`)) {
        pressDue.set(target, t + LONG_PRESS);
        longPressed.delete(target);
      }
      if (name === "up" || name === "cancel" || name === "dragstart" || name === "pinchstart") pressDue.delete(target);
      if (name === "tap" && longPressed.delete(target)) return false;
      const handled = dispatch(event, t);
      if (name === "tap" && wants.has(`${target}.doubletap`)) {
        const previous = lastTap.get(target);
        if (previous !== undefined && t - previous <= DOUBLE_TAP + 1e-9) {
          lastTap.delete(target);
          return dispatch(`${target}.doubletap`, t) || handled;
        }
        lastTap.set(target, t);
      }
      return handled;
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
      // A target read from this input moves to the new value with its motion, before any
      // event the sample derives.
      if (targetInputs.has(name)) settle(t, [], []);
      // Direction first: a scroll that has come back SCROLL_SLOP from its furthest point turns.
      const scroll = scrolls.get(name);
      if (scroll) {
        if (scroll.dir !== "forth" && value >= scroll.ref + SCROLL_SLOP) {
          [scroll.dir, scroll.ref] = ["forth", value];
          dispatch(scroll.forth, t);
        } else if (scroll.dir !== "back" && value <= scroll.ref - SCROLL_SLOP) {
          [scroll.dir, scroll.ref] = ["back", value];
          dispatch(scroll.back, t);
        } else if (scroll.dir === "forth") scroll.ref = Math.max(scroll.ref, value);
        else if (scroll.dir === "back") scroll.ref = Math.min(scroll.ref, value);
      }
      // Then crossings: each fires once on entering its side, and again only after leaving it.
      for (const c of crossings) {
        if (c.input !== name) continue;
        const inside = c.above ? value > c.value : value < c.value;
        if (inside && !c.inside) dispatch(c.event, t);
        c.inside = inside;
      }
      return true;
    },

    requiredInputs() {
      return [...requiredInputs];
    },

    measurements() {
      const out = new Set<string>();
      for (const [key, m] of measuredBases) for (const name of inputsOf(key, m)) out.add(name);
      for (const [key, prop] of program.properties) {
        if (!prop.map) continue;
        const context = prop.map.sourceKind === "property" ? prop.map.source : key;
        for (const point of prop.map.from) if (typeof point !== "number") for (const name of inputsOf(context, point)) out.add(name);
        for (const value of prop.map.to) if (!Array.isArray(value)) for (const name of inputsOf(key, value)) out.add(name);
      }
      const walk = (machine: Machine) => {
        if (machine.kind === "regions") {
          for (const region of machine.regions.values()) walk(region);
          return;
        }
        for (const state of machine.states.values()) {
          for (const [key, m] of state.measure) for (const name of inputsOf(key, m)) out.add(name);
          for (const [key, follow] of state.follow) {
            for (const point of follow.range ?? []) if (typeof point !== "number") for (const name of inputsOf(key, point)) out.add(name);
          }
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
        if (prop.map || !segment || segment.kind === "follow" || segment.kind === "glide") {
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
      if (property === undefined && (pending.some((timer) => timer.pausedAt === undefined) || pressDue.size > 0)) return false;
      const keys = property === undefined ? [...program.properties.keys()] : [property];
      return keys.every((key) => atRest(key, t));
    },

    time: () => now,

    looping: () => loops.size > 0,

    resting(t) {
      advanceTo(t);
      for (const key of program.properties.keys()) if (!atRest(key, t)) return false;
      return true;
    },
  };

  /** Whether one property has come to rest at `t`; see the spec's rest rule. */
  function atRest(key: string, t: number): boolean {
    const prop = program.properties.get(key);
    if (!prop) throw new Error(`Unknown property "${key}".`);
    if (prop.map?.sourceKind === "input") return true;
    const source = prop.map ? prop.map.source : key;
    const current = segments.get(source)!;
    // A pending motion is a change still to come.
    if (current.kind === "delayed" && t < current.t0) return false;
    const unwrapped = current.kind === "delayed" ? started(current) : current;
    const glide = unwrapped.kind === "glide" ? glideState(unwrapped, t) : undefined;
    // Still gliding: at rest once what is left of its travel is under the threshold.
    if (glide && !("motion" in glide)) return Math.abs(glide.vel) * (unwrapped as Segment & { kind: "glide" }).glide.momentum < REST.number;
    const segment: Exclude<Segment, { kind: "glide" | "delayed" }> = glide && "motion" in glide ? glide.motion : (unwrapped as Exclude<Segment, { kind: "glide" | "delayed" }>);
    // A followed value moves only when its input does; nothing is animating it.
    if (segment.kind === "follow") return true;
    if (segment.kind === "keyframes") return t - segment.t0 >= segment.duration;
    if (!segment.motion) return true;
    const motion = segment.motion;
    if (motion.kind === "tween") return t - segment.t0 >= motion.duration;
    // Remaining amplitude from the spring's energy. Energy never increases, so once
    // a property is at rest it stays at rest until its target changes.
    const [pos, vel] = evaluateMotion(segment, t);
    const eps = program.properties.get(source)!.kind === "color" ? REST.color : REST.number;
    const inertia = motion.mass / motion.stiffness;
    return pos.every((p, i) => Math.hypot(p - segment.to[i], vel[i] * Math.sqrt(inertia)) < eps);
  }
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

function evaluateKeyframes(segment: Segment & { kind: "keyframes" }, t: number): [Channels, Channels] {
  const u = (t - segment.t0) / segment.duration;
  if (u >= 1) return [segment.to.slice(), segment.to.map(() => 0)];
  const points = [{ at: 0, value: segment.from }, ...segment.frames, { at: 1, value: segment.to }];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (u > b.at) continue;
    const local = Math.max(0, (u - a.at) / (b.at - a.at));
    const progress = easeAt(segment.ease, local);
    const slope = easeSlope(segment.ease, local) / ((b.at - a.at) * segment.duration);
    return [a.value.map((value, channel) => value + (b.value[channel] - value) * progress), a.value.map((value, channel) => (b.value[channel] - value) * slope)];
  }
  return [segment.to.slice(), segment.to.map(() => 0)];
}

/** Every event a machine's transitions name, for deciding which gestures to derive. */
function handledEventNames(machine: Machine, out = new Set<string>()): Set<string> {
  if (machine.kind === "regions") {
    for (const region of machine.regions.values()) handledEventNames(region, out);
    return out;
  }
  for (const key of machine.when.keys()) out.add(key);
  for (const state of machine.states.values()) {
    for (const key of state.when.keys()) out.add(key);
    for (const timer of state.timers) for (const pair of timer.pause) out.add(pair.on).add(pair.off);
    if (state.machine) handledEventNames(state.machine, out);
  }
  return out;
}

function collectTargetInputs(machine: Machine, out: Set<string>) {
  if (machine.kind === "regions") {
    for (const region of machine.regions.values()) collectTargetInputs(region, out);
    return;
  }
  for (const state of machine.states.values()) {
    for (const target of state.input.values()) out.add(target.input);
    if (state.machine) collectTargetInputs(state.machine, out);
  }
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
