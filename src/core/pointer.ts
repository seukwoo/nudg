// The pointer rules every adapter follows, in one place for hosts without the DOM:
// a press is `down`; past 4 logical units of travel a draggable target gets `dragstart`
// and `drag.x` / `drag.y` samples measured from the press; the release is `up` (or
// `cancel` outside), then `dragend` after a drag, or `tap` after a press that didn't
// drag. A second pointer on a target that handles pinches (v0.18) ends any drag and
// starts a pinch, with `pinch.scale`, `pinch.rotation`, `pinch.x` and `pinch.y` measured
// from where the two pointers were; lifting either ends it, and the press then doesn't
// tap. The Swift and Kotlin adapters implement the same rules.

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

/** Targets whose pinches the program listens for (v0.18). */
export function pinchableTargets(program: Program): Set<string> {
  const out = new Set<string>();
  for (const e of handledEvents(program)) {
    const [target, event] = e.split(".");
    if (event === "pinchstart" || event === "pinchend") out.add(target);
  }
  return out;
}

/** What a pinch reports, from where the two pointers were when it started. */
export function pinchInputs(start: [number, number][], now: [number, number][]): { scale: number; rotation: number; x: number; y: number } {
  const [a0, b0] = start;
  const [a, b] = now;
  const d0 = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]);
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
  let rotation = ((Math.atan2(b[1] - a[1], b[0] - a[0]) - Math.atan2(b0[1] - a0[1], b0[0] - a0[0])) * 180) / Math.PI;
  // The turn between the two, in (-180, 180].
  rotation -= 360 * Math.ceil(rotation / 360 - 0.5);
  return { scale: d0 === 0 ? 1 : d / d0, rotation, x: (a[0] + b[0] - a0[0] - b0[0]) / 2, y: (a[1] + b[1] - a0[1] - b0[1]) / 2 };
}

export class PointerTracker {
  private origin: [number, number] | undefined;
  /** The pointer that pressed first: it alone drags, taps and releases the press. */
  private first: number | undefined;
  private dragging = false;
  /** Every pointer on the target, by id, where it is now. */
  private readonly points = new Map<number, [number, number]>();
  /** The two pointers of a pinch and where they were when it started (v0.18). */
  private pinch: { ids: [number, number]; start: [number, number][] } | undefined;
  /** This press pinched, so it neither drags nor taps afterwards. */
  private pinched = false;
  private readonly target: string;
  private readonly draggable: boolean;
  private readonly pinchable: boolean;
  private readonly sink: PointerSink;

  constructor(target: string, draggable: boolean, sink: PointerSink, pinchable = false) {
    this.target = target;
    this.draggable = draggable;
    this.sink = sink;
    this.pinchable = pinchable;
  }

  /** Pointer `id` pressed at (x, y), in logical units in any fixed space. A second one on a pinchable target starts a pinch. */
  down(x: number, y: number, id = 0) {
    this.points.set(id, [x, y]);
    if (this.origin === undefined) {
      this.origin = [x, y];
      this.first = id;
      this.dragging = false;
      this.pinched = false;
      this.sink.send(`${this.target}.down`);
      return;
    }
    if (!this.pinchable || this.pinch || this.points.size !== 2) return;
    // A drag in progress becomes the pinch.
    if (this.dragging) {
      this.dragging = false;
      this.sink.send(`${this.target}.dragend`);
    }
    const ids: [number, number] = [this.first!, id];
    this.pinch = { ids, start: ids.map((i) => this.points.get(i)!) };
    this.pinched = true;
    this.sink.send(`${this.target}.pinchstart`);
  }

  move(x: number, y: number, id = 0) {
    if (!this.points.has(id)) return;
    this.points.set(id, [x, y]);
    if (this.pinch) {
      if (!this.pinch.ids.includes(id)) return;
      const now = this.pinch.ids.map((i) => this.points.get(i)!);
      const inputs = pinchInputs(this.pinch.start, now);
      for (const name of ["scale", "rotation", "x", "y"] as const) this.sink.input(`${this.target}.pinch.${name}`, inputs[name]);
      return;
    }
    if (!this.origin || id !== this.first || !this.draggable || this.pinched) return;
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

  /** Pointer `id` released; `inside` is false when it left the target. */
  up(inside = true, id = 0) {
    if (!this.points.delete(id)) return;
    if (this.pinch?.ids.includes(id)) {
      this.pinch = undefined;
      this.sink.send(`${this.target}.pinchend`);
    }
    if (id !== this.first || !this.origin) return;
    this.origin = undefined;
    this.first = undefined;
    this.sink.send(`${this.target}.${inside ? "up" : "cancel"}`);
    if (this.dragging) this.sink.send(`${this.target}.dragend`);
    else if (inside && !this.pinched) this.sink.send(`${this.target}.tap`);
    this.dragging = false;
  }

  /** The system took the gesture away (a scroll, a call). */
  cancel() {
    if (!this.origin) return;
    this.origin = undefined;
    this.first = undefined;
    this.points.clear();
    this.sink.send(`${this.target}.cancel`);
    if (this.pinch) this.sink.send(`${this.target}.pinchend`);
    if (this.dragging) this.sink.send(`${this.target}.dragend`);
    this.pinch = undefined;
    this.dragging = false;
  }
}

/** The DOM's key names: `KeyboardEvent.key`, lowercased, with " " as "space". */
export function keyName(key: string): string {
  return key === " " ? "space" : key.toLowerCase();
}
