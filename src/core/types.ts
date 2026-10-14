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
  /** Strictly monotonic points on the source. */
  from: number[];
  to: Channels[];
}

export interface Property {
  kind: PropertyKind;
  /** For a mapped property, its value at the source's base. */
  base: Channels;
  map?: PropertyMap;
}

/** A property tracking an input while a state is active (v0.2). */
export interface Follow {
  input: string;
  range?: [number, number];
  overdrag: number;
}

export interface Transition {
  /** The target state, unless `nearest` picks it. */
  to?: string;
  nearest?: { states: string[]; by: string; momentum: number };
  animate: Map<string, Motion>;
}

export interface State {
  name: string;
  set: Map<string, Channels>;
  follow: Map<string, Follow>;
  enter: Map<string, SpringMotion>;
  when: Map<string, Transition>;
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
