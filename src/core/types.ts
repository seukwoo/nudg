// The compiled, validated model the runtime executes. Raw JSON never reaches the runtime.

export type Severity = "error" | "warning";

export interface Diagnostic {
  severity: Severity;
  /** Stable, machine-readable code, e.g. "unknown-key". Part of the spec. */
  code: string;
  message: string;
  /** JSON pointer into the file, e.g. "/states/on/set/knob.x". */
  path: string;
  /** Set when the diagnostic belongs to an imported file. */
  file?: string;
  /** How to fix it, phrased as an instruction. */
  hint?: string;
}

export type PropertyKind = "length" | "number" | "color";

/** A value as channels: one for numbers, four (OKLab L, a, b, alpha) for colors. */
export type Channels = number[];

export type Ease = "linear" | readonly [number, number, number, number];

export interface SpringMotion {
  kind: "spring";
  stiffness: number;
  damping: number;
  mass: number;
  /** Velocity added on start, in units per second. Only on numeric properties. */
  kick?: number;
  /** Seconds before the motion starts, in "animate" only (v0.12). */
  delay?: number;
  /** A delay read from an app input when the transition fires (v1.2), instead of `delay`. */
  delayInput?: DelayInput;
}

export interface TweenMotion {
  kind: "tween";
  /** Seconds. */
  duration: number;
  ease: Ease;
  /** Seconds before the motion starts, in "animate" only (v0.12). */
  delay?: number;
  /** A delay read from an app input when the transition fires (v1.2), instead of `delay`. */
  delayInput?: DelayInput;
}

export type Motion = SpringMotion | TweenMotion;

/** A delay from an app input (v1.2): `input × times + plus` seconds, from 0 up to `max`. */
export interface DelayInput {
  input: string;
  times: number;
  plus: number;
  max?: number;
}

export interface Keyframe {
  /** Normalized time strictly between 0 and 1; the current value and state target are implicit endpoints. */
  at: number;
  /** For a measured frame (1.5), a placeholder; `measure` holds the value. */
  value: Channels;
  /** A value read from layout (1.5), resolved as the frame plays; left out until reported. */
  measure?: Measure;
  /** The ease of the leg after this frame (1.5), instead of the effect's. */
  ease?: Ease;
  /** Cues on this beat (1.3). */
  cues?: Cue[];
}

/** A number, or one read from an app input when the cue fires (1.3): input × times + plus. */
export type CueAmount = number | { input: string; times: number; plus: number };

/**
 * A named moment for sound and haptics (1.3). The file holds names and numbers; the host
 * maps sound names to its files, and adapters map haptic names to each platform's feedback.
 */
export interface Cue {
  sound?: string;
  haptic?: string;
  /** 0 to 1, default 1. */
  intensity?: CueAmount;
  /** Semitones, default 0. */
  pitch?: CueAmount;
  /** Seconds after the moment, as a motion's delay (a number, or read from an input). */
  delay?: number | DelayInput;
  /** Fires `count` times in all, `every` seconds apart. */
  repeat?: { count: number; every: number };
  /** The least time between two firings of this cue; a firing sooner is dropped. */
  throttle?: number;
}

/** A transient authored sequence played when a state is entered (v0.8). */
export interface KeyframesEffect {
  kind: "keyframes";
  frames: Keyframe[];
  duration: number;
  ease: Ease;
}

export type EntryEffect = SpringMotion | KeyframesEffect;

/**
 * A periodic offset added to a property while its state is active (v0.10). One cycle
 * starts at 0, passes through `frames` and ends at `to`, then repeats.
 */
export interface Loop {
  /** The offset at the end of a cycle: 360 for a turning spinner, 0 for a pulse. */
  to: MeasuredEndpoint;
  /** Points strictly inside the cycle, in normalized time. */
  frames: { at: number; value: MeasuredEndpoint; ease?: Ease; cues?: Cue[] }[];
  /** Seconds per cycle. */
  duration: number;
  ease: Ease;
  /** Seconds after entry before the first cycle; the offset holds at 0 until then. */
  delay: number;
  /** When the loop ends, the offset is reduced by this period to its equivalent nearest 0. */
  wrap?: number;
}

/** A numeric point, optionally supplied by the host's layout report (v0.9). */
export type MeasuredEndpoint = number | Measure;

/** A property computed from another at every moment (v0.2). */
export interface PropertyMap {
  source: string;
  /** A property in older formats; a host-supplied continuous input in v0.5. */
  sourceKind: "property" | "input";
  /** Source points; measured endpoints resolve from layout in v0.9. */
  from: MeasuredEndpoint[];
  /** Values at those points; numeric ones may be measured in v0.11, in the mapped property's coordinates. */
  to: (Channels | Measure)[];
}

/** A value read from the host's layout report (v0.4), optionally scaled and offset (v0.6). */
export interface Measure {
  target: string;
  /** x and y align (the measured box's position minus this property's own target's); sizes are the size. */
  of: "x" | "y" | "width" | "height" | "naturalWidth" | "naturalHeight";
  /** Multiplies the measured size or aligned position. Defaults to 1. */
  times: number;
  /** Added after multiplication. Defaults to 0. */
  plus: number;
}

/** A state target read from a continuous input (v0.17), scaled and offset like a measurement. */
export interface InputTarget {
  input: string;
  times: number;
  plus: number;
}

export interface Property {
  kind: PropertyKind;
  /** A base value measured from layout instead of a number (v0.4). `base` holds 0 until then. */
  measure?: Measure;
  /** For a mapped property, its value at the source's base. */
  base: Channels;
  map?: PropertyMap;
  /** Bounds for step, commit and follow (v0.3); numeric properties only. */
  min?: number;
  max?: number;
}

/** A property tracking an input while a state is active (v0.2). */
export interface Follow {
  input: string;
  range?: [MeasuredEndpoint, MeasuredEndpoint];
  overdrag: number;
  /** Scale by the input's ratio since entry instead of adding its change, for a pinch (v0.18). */
  multiply?: boolean;
}

/**
 * A property that keeps the velocity it had on entering the state and slows down by itself
 * (v0.16): it travels velocity × momentum in all, like `nearest`'s projection, and settles
 * at a range bound with its own motion if it reaches one.
 */
export interface Glide {
  /** Seconds: the time constant of the slowdown. Larger glides further. */
  momentum: number;
  range?: [MeasuredEndpoint, MeasuredEndpoint];
}

export interface Transition {
  /** The target state, unless `nearest` picks it, or the transition only steps (v0.3). */
  to?: string;
  nearest?: { states: string[]; by: string; momentum: number };
  animate: Map<string, Motion>;
  /** Added to each property's base value, clamped to its bounds (v0.3). */
  step?: Map<string, number>;
  /** Properties whose current value becomes their base value (v0.3). */
  commit?: string[];
  /** Cues when the transition fires (1.3). */
  cues?: Cue[];
  /** Emitters that send out a wave when the transition fires (1.4). */
  emit?: string[];
}

export interface TimerPause {
  /** Pauses the timer while this reason is active (v0.7). */
  on: string;
  /** Clears this pause reason. */
  off: string;
}

/** A transition that fires `delay` active seconds after its state was entered (v0.3, pause in v0.7). */
export interface Timer {
  key: string;
  delay: number;
  transition: Transition;
  pause: TimerPause[];
}

export interface State {
  name: string;
  set: Map<string, Channels>;
  /** Entries of `set` that are measured (v0.4); their `set` value is a placeholder. */
  measure: Map<string, Measure>;
  /** Entries of `set` read from an input (v0.17); their `set` value is a placeholder. */
  input: Map<string, InputTarget>;
  follow: Map<string, Follow>;
  /** Properties that glide on with their velocity while the state is active (v0.16). */
  glide: Map<string, Glide>;
  enter: Map<string, EntryEffect>;
  /** Periodic offsets while the state is active (v0.10). */
  loop: Map<string, Loop>;
  when: Map<string, Transition>;
  timers: Timer[];
  machine?: Machine;
  /** Cues when the state is entered through a transition (1.3). */
  cues?: Cue[];
  /** Emitters that send out a wave when the state is entered through a transition (1.4). */
  emit?: string[];
}

export type Machine =
  | {
      kind: "states";
      initial: string;
      states: Map<string, State>;
      /** Transitions from any of these states, when none of them handles the event (v0.2). */
      when: Map<string, Transition>;
    }
  | { kind: "regions"; regions: Map<string, Machine> };

/** What a file declares it exchanges with the app (v0.13): the contract, not behavior. */
export interface HostDeclaration {
  /** Event names without "host.", in file order. */
  events: string[];
  /** Input names without "host.", with the range the app sends them in, when declared. */
  inputs: Map<string, { range?: [number, number] }>;
  /** Custom property names (1.3), drawn by the host: target.custom.<name>. */
  custom?: string[];
}

/**
 * An emitter (1.4): many short-lived pieces from one place. Each piece's path is closed form
 * (launch velocity, linear drag, gravity, spin, a fade at the end of its life), with its
 * numbers drawn from the seed, the wave and its index, so every runtime places it the same.
 */
export interface Emitter {
  /** The target whose box the pieces start from. */
  from: string;
  /** Where on that box: its center or the middle of an edge. */
  at: "center" | "top" | "bottom" | "left" | "right";
  count: number;
  /** A box around that point, in logical units, that pieces start anywhere in. */
  area: [number, number];
  /** Launch direction in degrees, 0 to the right and -90 up, from low to high. */
  angle: [number, number];
  /** Launch speed, units per second. */
  speed: [number, number];
  /** Units per second squared, downward. */
  gravity: number;
  /** Linear drag per second: velocity falls by e^(-drag × t). */
  drag: number;
  /** Degrees per second. */
  spin: [number, number];
  /** Seconds a piece lives. */
  life: [number, number];
  /** Seconds at the end of its life over which a piece fades out. */
  fade: number;
  scale: [number, number];
  /** Seconds between one piece's launch and the next. */
  stagger: number;
  seed: number;
}

export interface Program {
  version: string;
  targets: string[];
  /** Present when the file declares "host" (v0.13); then no other host.* name is accepted. */
  host?: HostDeclaration;
  /** Keyed by path, e.g. "knob.x". */
  properties: Map<string, Property>;
  animate: Map<string, Motion>;
  machine: Machine;
  /** Emitters by name (1.4); each name is also a target, where its pieces are drawn. */
  emitters?: Map<string, Emitter>;
}

/**
 * The names a host may use with a file. `nudg generate` writes one per file; the adapters
 * take it as a type argument (`useNudg<ToggleContract>(toggle)`) and default to plain strings.
 */
export interface NudgContract {
  targets: string;
  events: string;
  inputs: string;
  states: string;
}

/** A state path or its last name, as `exit` accepts: "open/hidden" or "hidden". */
export type StateName<C extends NudgContract> = C["states"] | LastName<C["states"]>;
type LastName<P extends string> = P extends `${string}/${infer R}` ? LastName<R> : P;
