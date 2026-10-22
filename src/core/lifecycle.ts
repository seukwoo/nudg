// What a host hears about a player's life, the same in every adapter: the active states
// when they change, when everything has come to rest (settle), and when the component
// has exited. Adapters call `changed` after an event, input or relayout and `frame` after
// applying the values of a frame.

import type { Runtime } from "./runtime.ts";

export interface LifecycleHooks {
  /** States that mean the component is gone; see the adapters' `exit`. */
  exit?: string | string[];
  /** The active states, after an event or timer changes them. */
  onState?: (state: string[]) => void;
  /**
   * Every value has come to rest after something moved or the state changed. Called once
   * per rest, with the active states: an interrupted motion reports only the rest that
   * follows the interruption. Pending timers don't delay it, and values that follow an
   * input or are mapped from one count as at rest, as does a running loop's offset.
   */
  onSettle?: (state: string[]) => void;
  /** The machine has entered an exit state from elsewhere and is settled. */
  onExit?: () => void;
}

export interface Lifecycle {
  /** After an event, input sample or layout report, at the runtime's current time. */
  changed(): void;
  /** After the values at `t` were applied. True while the host should keep sending frames, including while a loop runs. */
  frame(t: number): boolean;
  /** False once the component has exited, until it leaves the exit state again. */
  present(): boolean;
}

export function createLifecycle(runtime: Runtime, hooks: LifecycleHooks): Lifecycle {
  const exits = new Set(typeof hooks.exit === "string" ? [hooks.exit] : (hooks.exit ?? []));
  const inExit = () => runtime.state().some((path) => exits.has(path) || exits.has(path.split("/").pop()!));
  let lastState = runtime.state().join("\n");
  // A settle is owed once something moved or the state changed, and paid at the next rest.
  let owed = false;
  let present = true;
  // Only an exit entered from somewhere else counts; mounting in "hidden" hasn't exited anything.
  let armed = exits.size > 0 && !inExit();

  const syncState = () => {
    const state = runtime.state();
    if (state.join("\n") === lastState) return;
    lastState = state.join("\n");
    owed = true;
    hooks.onState?.(state);
  };
  const syncPresence = (t: number) => {
    if (exits.size === 0) return;
    if (!inExit()) {
      armed = true;
      present = true;
      return;
    }
    if (armed && present && runtime.settled(t)) {
      present = false;
      armed = false;
      hooks.onExit?.();
    }
  };

  return {
    changed() {
      syncState();
      // Read the time after onState: a host may send more from inside it.
      const t = runtime.time();
      if (!runtime.resting(t)) owed = true;
      // An exit with nothing left to move is complete at once; otherwise frames finish it.
      syncPresence(t);
    },
    frame(at) {
      syncState(); // timers may have fired while time advanced
      const t = Math.max(at, runtime.time());
      if (!runtime.resting(t)) owed = true;
      else if (owed) {
        owed = false;
        hooks.onSettle?.(runtime.state());
      }
      const settled = runtime.settled(t);
      if (settled) syncPresence(t);
      return !settled || owed || runtime.looping();
    },
    present: () => present,
  };
}
