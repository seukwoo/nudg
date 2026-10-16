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
