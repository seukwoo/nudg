// The pointer rules every adapter follows, in one place for hosts without the DOM:
// a press is `down`; past 4 logical units of travel a draggable target gets `dragstart`
// and `drag.x` / `drag.y` samples measured from the press; the release is `up` (or
// `cancel` outside), then `dragend` after a drag, or `tap` after a press that didn't
// drag. The Swift and Kotlin adapters implement the same rules.

import { handledEvents } from "./observe.ts";
import type { Program } from "./types.ts";

/** Logical units the pointer must travel before a press becomes a drag. */
export const DRAG_SLOP = 4;

export interface PointerSink {
  send(event: string): void;
  input(name: string, value: number): void;
}

/** Targets whose drags the program listens for. */
export function draggableTargets(program: Program): Set<string> {
  const out = new Set<string>();
  for (const e of handledEvents(program)) {
    const [target, event] = e.split(".");
    if (event === "dragstart" || event === "dragend") out.add(target);
  }
  return out;
}

export class PointerTracker {
  private origin: [number, number] | undefined;
  private dragging = false;
  private readonly target: string;
  private readonly draggable: boolean;
  private readonly sink: PointerSink;

  constructor(target: string, draggable: boolean, sink: PointerSink) {
    this.target = target;
    this.draggable = draggable;
    this.sink = sink;
  }

  /** Pointer pressed at (x, y), in logical units in any fixed space. */
  down(x: number, y: number) {
    this.origin = [x, y];
    this.dragging = false;
    this.sink.send(`${this.target}.down`);
  }

  move(x: number, y: number) {
    if (!this.origin || !this.draggable) return;
    const dx = x - this.origin[0];
    const dy = y - this.origin[1];
    if (!this.dragging) {
      if (Math.hypot(dx, dy) <= DRAG_SLOP) return;
      this.dragging = true;
      this.sink.send(`${this.target}.dragstart`);
    }
    // Travel since the press, so the value catches up with the finger instead of lagging by the slop.
    this.sink.input(`${this.target}.drag.x`, dx);
    this.sink.input(`${this.target}.drag.y`, dy);
  }

  /** Released; `inside` is false when the pointer left the target. */
  up(inside = true) {
    if (!this.origin) return;
    this.origin = undefined;
    this.sink.send(`${this.target}.${inside ? "up" : "cancel"}`);
    if (this.dragging) this.sink.send(`${this.target}.dragend`);
    else if (inside) this.sink.send(`${this.target}.tap`);
    this.dragging = false;
  }

  /** The system took the gesture away (a scroll, a call). */
  cancel() {
    if (!this.origin) return;
    this.origin = undefined;
    this.sink.send(`${this.target}.cancel`);
    if (this.dragging) this.sink.send(`${this.target}.dragend`);
    this.dragging = false;
  }
}

/** The DOM's key names: `KeyboardEvent.key`, lowercased, with " " as "space". */
export function keyName(key: string): string {
  return key === " " ? "space" : key.toLowerCase();
}
