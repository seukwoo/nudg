// The pointer rules native adapters share: press, slop, drag inputs, release.

import assert from "node:assert/strict";
import { test } from "node:test";
import { createPlayer, toProgram } from "../src/core/player.ts";
import { PointerTracker, draggableTargets } from "../src/core/pointer.ts";
import { readFileSync } from "node:fs";

const toggleDrag = toProgram(JSON.parse(readFileSync("examples/toggle-drag.nudg.json", "utf8")));

function fakeHost() {
  let t = 0;
  const queue: (() => void)[] = [];
  return { host: { now: () => t, frame: (fn: () => void) => (queue.push(fn), () => {}) }, advance(dt: number) { t += dt; queue.splice(0).forEach((f) => f()); } };
}

test("a press that doesn't travel taps; a drag past the slop drags and doesn't tap", () => {
  const log: string[] = [];
  const t = new PointerTracker("track", true, { send: (e) => log.push(e), input: (n, v) => log.push(`${n}=${v}`) });
  t.down(0, 0);
  t.move(3, 0);
  t.up();
  assert.deepEqual(log, ["track.down", "track.up", "track.tap"]);
  log.length = 0;
  t.down(0, 0);
  t.move(3, 0);
  t.move(10, 1);
  t.up();
  assert.deepEqual(log, ["track.down", "track.dragstart", "track.drag.x=10", "track.drag.y=1", "track.up", "track.dragend"]);
  log.length = 0;
  t.down(0, 0);
  t.up(false);
  assert.deepEqual(log, ["track.down", "track.cancel"], "released outside: cancel, no tap");
});

test("non-draggable targets never drag; draggableTargets reads the file", () => {
  assert.deepEqual([...draggableTargets(toggleDrag)], ["track"]);
  const log: string[] = [];
  const t = new PointerTracker("knob", false, { send: (e) => log.push(e), input: () => log.push("input") });
  t.down(0, 0);
  t.move(40, 0);
  t.up();
  assert.deepEqual(log, ["knob.down", "knob.up", "knob.tap"]);
});

test("dragging the toggle's track 30 units to the right turns it on, through the player", () => {
  const h = fakeHost();
  const p = createPlayer(toggleDrag, { host: h.host });
  const t = new PointerTracker("track", true, p);
  t.down(100, 50);
  for (let i = 1; i <= 6; i++) {
    h.advance(1 / 60);
    t.move(100 + i * 5, 50);
  }
  t.up();
  for (let i = 0; i < 120; i++) h.advance(1 / 60);
  assert.deepEqual(p.runtime.state(), ["on"]);
  assert.ok(Math.abs((p.values()["knob.x"] as number) - 20) < 0.01);
});

test("a second pointer on a pinchable target ends the drag and pinches; the press then doesn't tap", () => {
  const log: string[] = [];
  const t = new PointerTracker("image", true, { send: (e) => log.push(e), input: (n, v) => log.push(`${n}=${Math.round(v * 100) / 100}`) }, true);
  t.down(100, 100, 1);
  t.move(110, 100, 1);
  t.down(200, 100, 2);
  // 90 apart when the pinch starts (the first pointer had moved to 110, 100); then
  // 90.55 apart turned -6.34 degrees, then 200 apart (2.22) turned a quarter.
  t.move(110, 110, 1);
  t.move(110, 310, 2);
  t.up(true, 2);
  t.move(150, 150, 1);
  t.up(true, 1);
  assert.deepEqual(log, [
    "image.down",
    "image.dragstart",
    "image.drag.x=10",
    "image.drag.y=0",
    "image.dragend",
    "image.pinchstart",
    "image.pinch.scale=1.01",
    "image.pinch.rotation=-6.34",
    "image.pinch.x=0",
    "image.pinch.y=5",
    "image.pinch.scale=2.22",
    "image.pinch.rotation=90",
    "image.pinch.x=-45",
    "image.pinch.y=110",
    "image.pinchend",
    "image.up",
  ]);
});

test("pinch inputs: ratio of distances, turn in (-180, 180], centre travel", async () => {
  const { pinchInputs } = await import("../src/core/pointer.ts");
  assert.deepEqual(pinchInputs([[0, 0], [10, 0]], [[0, 0], [20, 0]]), { scale: 2, rotation: 0, x: 5, y: 0 });
  assert.equal(pinchInputs([[0, 0], [10, 0]], [[0, 0], [-10, 0]]).rotation, 180);
  assert.equal(Math.round(pinchInputs([[0, 0], [10, 0]], [[0, 0], [0, -10]]).rotation), -90);
});

test("React Native's touch lists drive the tracker: a tap, and a second finger that pinches", async () => {
  const { touchSync } = await import("../src/native/touches.ts");
  const log: string[] = [];
  const sink = { send: (e: string) => log.push(e), input: (n: string, v: number) => log.push(`${n}=${Math.round(v * 100) / 100}`) };
  const tap = touchSync(new PointerTracker("button", false, sink));
  tap.sync([{ identifier: 3, pageX: 10, pageY: 10 }], false);
  tap.sync([], true);
  assert.deepEqual(log.splice(0), ["button.down", "button.up", "button.tap"]);

  const pinch = touchSync(new PointerTracker("image", true, sink, true));
  pinch.sync([{ identifier: 1, pageX: 100, pageY: 100 }], false);
  pinch.sync([{ identifier: 1, pageX: 100, pageY: 100 }, { identifier: 2, pageX: 140, pageY: 100 }], false);
  pinch.sync([{ identifier: 1, pageX: 80, pageY: 100 }, { identifier: 2, pageX: 160, pageY: 100 }], false);
  pinch.sync([], true);
  // Each finger in an event is reported in turn, so the first one's move is a sample of its own.
  assert.deepEqual(log.splice(0), [
    "image.down",
    "image.pinchstart",
    "image.pinch.scale=1.5",
    "image.pinch.rotation=0",
    "image.pinch.x=-10",
    "image.pinch.y=0",
    "image.pinch.scale=2",
    "image.pinch.rotation=0",
    "image.pinch.x=0",
    "image.pinch.y=0",
    "image.pinchend",
    "image.up",
  ]);
});
