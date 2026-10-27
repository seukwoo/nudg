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
 * View props that let screen readers activate a target whose tap the file handles:
 * activation is a tap, as a click is on the web. Nothing for other targets.
 */
export function activation(handled: Set<string>, target: string, send: (event: string) => void): Record<string, unknown> {
  const tap = `${target}.tap`;
  if (!handled.has(tap)) return {};
  return {
    accessibilityActions: [{ name: "activate" }],
    onAccessibilityAction: (e: { nativeEvent: { actionName: string } }) => {
      if (e.nativeEvent.actionName === "activate") send(tap);
    },
  };
}
