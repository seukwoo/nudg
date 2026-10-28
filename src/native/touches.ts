// React Native reports every finger on the screen with each responder event; the pointer
// tracker wants each one's down, moves and up. This turns the first into the second, kept
// apart from the hook so it runs without React Native.

import type { PointerTracker } from "../core/pointer.ts";

export interface Touch {
  identifier: number | string;
  pageX: number;
  pageY: number;
}

/** Feeds a tracker from responder events: `sync` with each event's touches, `cancel` when the responder is taken away. */
export function touchSync(tracker: PointerTracker): { sync(touches: Touch[], release: boolean): void; cancel(): void } {
  const down = new Set<number>();
  const id = (identifier: number | string) => Number(identifier) || 0;
  return {
    sync(touches, release) {
      const now = new Set(touches.map((t) => id(t.identifier)));
      for (const t of touches) {
        const i = id(t.identifier);
        if (!down.has(i)) {
          down.add(i);
          tracker.down(t.pageX, t.pageY, i);
        } else tracker.move(t.pageX, t.pageY, i);
      }
      // Fingers that left, or all of them on release; the first to go down is released first.
      for (const i of [...down]) {
        if (now.has(i) && !release) continue;
        down.delete(i);
        tracker.up(true, i);
      }
    },
    cancel() {
      down.clear();
      tracker.cancel();
    },
  };
}

/**
 * View props that let screen readers act on a target as keyboards and pointers do on the
 * web: activation is its tap; increment and decrement (an adjustable view) are its arrow
 * keys, arrowright or arrowup and arrowleft or arrowdown. Only what the file handles.
 */
export function activation(handled: Set<string>, target: string, send: (event: string) => void): Record<string, unknown> {
  const first = (...names: string[]) => names.map((n) => `${target}.${n}`).find((e) => handled.has(e));
  const events: Record<string, string | undefined> = {
    activate: first("tap"),
    increment: first("key.arrowright", "key.arrowup"),
    decrement: first("key.arrowleft", "key.arrowdown"),
  };
  const actions = Object.keys(events).filter((name) => events[name]);
  if (!actions.length) return {};
  return {
    accessibilityActions: actions.map((name) => ({ name })),
    onAccessibilityAction: (e: { nativeEvent: { actionName: string } }) => {
      const event = events[e.nativeEvent.actionName];
      if (event) send(event);
    },
  };
}
