// A headless player: a runtime plus the loop that drives it, for hosts that aren't the
// DOM (React Native, a canvas, a game loop). The host supplies the clock and the frame
// scheduler, so the core still never reads a platform API; values go out through
// onFrame, events and inputs come in through send and input.

import { compile } from "./compile.ts";
import { createLifecycle } from "./lifecycle.ts";
import { createRuntime, type Runtime, type Value } from "./runtime.ts";
import type { NudgContract, Program, StateName } from "./types.ts";

export interface PlayerHost {
  /** Seconds, increasing; any origin. */
  now(): number;
  /** Calls `fn` on the next frame; returns a function that cancels it. */
  frame(fn: () => void): () => void;
}

export interface HeadlessOptions<C extends NudgContract = NudgContract> {
  host: PlayerHost;
  state?: C["states"][];
  reducedMotion?: boolean;
  /** Time scale: 0.25 plays everything at quarter speed. Default 1. */
  speed?: number;
  /** Called with the values whenever they change: apply them to the views. */
  onFrame?: (values: Record<string, Value>) => void;
  /** Called with the active states after an event or timer changes them. */
  onState?: (state: C["states"][]) => void;
  /** States that mean the component is gone; see the DOM adapter's `exit`. */
  exit?: StateName<C> | StateName<C>[];
  onExit?: () => void;
  /** Every value has come to rest after something moved or the state changed; see the DOM adapter's `onSettle`. */
  onSettle?: (state: C["states"][]) => void;
}

export interface HeadlessPlayer<C extends NudgContract = NudgContract> {
  readonly runtime: Runtime;
  send(event: C["events"]): boolean;
  input(name: C["inputs"], value: number): boolean;
  values(): Record<string, Value>;
  present(): boolean;
  /** The player's time in seconds. */
  now(): number;
  destroy(): void;
}

export function createPlayer<C extends NudgContract = NudgContract>(program: Program, options: HeadlessOptions<C>): HeadlessPlayer<C> {
  const { host } = options;
  const speed = options.speed ?? 1;
  if (!(speed > 0)) throw new RangeError("`speed` must be greater than 0.");
  const start = host.now();
  const now = () => (host.now() - start) * speed;
  const runtime = createRuntime(program, { state: options.state, reducedMotion: options.reducedMotion });
  let cancel: (() => void) | undefined;
  let destroyed = false;
  let lastValues: Record<string, Value> = runtime.sample(0);
  const life = createLifecycle(runtime, { exit: options.exit, onState: options.onState, onSettle: options.onSettle, onExit: options.onExit });
  const tick = () => {
    cancel = undefined;
    if (destroyed) return;
    const t = now();
    lastValues = runtime.sample(t);
    options.onFrame?.(lastValues);
    if (life.frame(t)) cancel = host.frame(tick);
  };
  const changed = () => {
    if (!cancel) cancel = host.frame(tick);
    life.changed();
  };
  options.onFrame?.(lastValues);

  return {
    runtime,
    send(event) {
      if (destroyed) return false;
      const handled = runtime.send(event, now());
      changed();
      return handled;
    },
    input(name, value) {
      if (destroyed) return false;
      const used = runtime.input(name, value, now());
      changed();
      return used;
    },
    values: () => lastValues,
    present: () => life.present(),
    now,
    destroy() {
      destroyed = true;
      cancel?.();
      cancel = undefined;
    },
  };
}

export interface InitialOptions {
  /** Leaf state paths to start in instead of `initial`, as the adapters' `state` option. */
  state?: string[];
  /** Continuous app inputs already known, e.g. { "host.progress": 0.6 }. Others start at 0. */
  inputs?: Record<string, number>;
}

/**
 * The values a player shows before anything happens: the starting states, app inputs as
 * given (others 0), and measured values at their base until the host reports layout.
 * Entry effects of the starting states don't play on load. A server renders these, and
 * the adapters start from the same values, so hydration doesn't jump.
 */
export function initialValues(program: Program, options: InitialOptions = {}): Record<string, Value> {
  const runtime = createRuntime(program, { state: options.state });
  for (const [name, value] of Object.entries(options.inputs ?? {})) runtime.input(name, value, 0);
  return runtime.sample(0);
}

/** Compiles a document (with the files it imports) or passes a Program through; throws with every error. */
export function toProgram(source: Program | object, files: Record<string, unknown> = {}): Program {
  if ("machine" in source && (source as Program).properties instanceof Map) return source as Program;
  const byPath = new Map(Object.entries(files).map(([key, value]) => [key.replace(/^(\.\/)+/, ""), value]));
  const { program, diagnostics } = compile({ path: "main.nudg.json", text: JSON.stringify(source) }, (path) =>
    byPath.has(path) ? JSON.stringify(byPath.get(path)) : undefined,
  );
  if (!program) {
    const lines = diagnostics.filter((d) => d.severity === "error").map((d) => `${d.code} at ${d.path}: ${d.message}${d.hint ? ` (${d.hint})` : ""}`);
    throw new Error(`nudg: the file has errors:\n${lines.join("\n")}`);
  }
  return program;
}
