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
}

export interface TweenMotion {
  kind: "tween";
  /** Seconds. */
  duration: number;
  ease: Ease;
}

export type Motion = SpringMotion | TweenMotion;

/** A property computed from another at every moment (v0.2). */
export interface PropertyMap {
  source: string;
  /** A property in older formats; a host-supplied continuous input in v0.5. */
  sourceKind: "property" | "input";
  /** Strictly monotonic points on the source. */
  from: number[];
  to: Channels[];
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
  range?: [number, number];
  overdrag: number;
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
}

/** A transition that fires `delay` seconds after its state was entered (v0.3). */
export interface Timer {
  key: string;
  delay: number;
  transition: Transition;
}

export interface State {
  name: string;
  set: Map<string, Channels>;
  /** Entries of `set` that are measured (v0.4); their `set` value is a placeholder. */
  measure: Map<string, Measure>;
  follow: Map<string, Follow>;
  enter: Map<string, SpringMotion>;
  when: Map<string, Transition>;
  timers: Timer[];
  machine?: Machine;
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

export interface Program {
  version: string;
  targets: string[];
  /** Keyed by path, e.g. "knob.x". */
  properties: Map<string, Property>;
  animate: Map<string, Motion>;
  machine: Machine;
}
