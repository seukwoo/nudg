// The headless player: a runtime driven by a host's clock and frames, for non-DOM hosts.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createPlayer, toProgram } from "../src/core/player.ts";
import { presets } from "../src/core/presets.ts";

/** A fake host: time moves only when we say, frames run when we flush them. */
function fakeHost() {
  let t = 0;
  const queue: (() => void)[] = [];
  return {
    host: { now: () => t, frame: (fn: () => void) => (queue.push(fn), () => queue.splice(queue.indexOf(fn), 1)) },
    advance(dt: number) {
      t += dt;
      const run = queue.splice(0);
      for (const fn of run) fn();
    },
    pending: () => queue.length,
  };
}

test("frames run while values move and stop at rest; values reach the views through onFrame", () => {
  const h = fakeHost();
  const frames: Record<string, unknown>[] = [];
  const p = createPlayer(toProgram(presets.toggle()), { host: h.host, onFrame: (v) => frames.push(v) });
  assert.equal(frames.length, 1, "the initial values are written once");
  assert.equal(p.send("track.tap"), true);
  for (let i = 0; i < 120 && h.pending(); i++) h.advance(1 / 60);
  assert.equal(h.pending(), 0, "no frames requested once settled");
  const last = frames.at(-1)!;
  assert.ok(Math.abs((last["knob.x"] as number) - 20) < 0.01, JSON.stringify(last));
  assert.deepEqual(p.runtime.state(), ["on"]);
});

test("presence: onExit once the exit has settled; destroyed players ignore events", () => {
  const h = fakeHost();
  let exits = 0;
  const p = createPlayer(toProgram(presets.toast({ duration: 0 })), { host: h.host, exit: "hidden", onExit: () => exits++ });
  p.send("host.show");
  for (let i = 0; i < 120 && h.pending(); i++) h.advance(1 / 60);
  assert.equal(p.present(), true);
  p.send("host.hide");
  assert.equal(p.present(), true, "still present while leaving");
  for (let i = 0; i < 120 && h.pending(); i++) h.advance(1 / 60);
  assert.equal(p.present(), false);
  assert.equal(exits, 1);
  p.destroy();
  assert.equal(p.send("host.show"), false);
});

test("layout inputs reach the runtime through input()", () => {
  const h = fakeHost();
  const doc = { nudg: "0.4", targets: ["a", "line"], values: { "line.width": { measure: "a.width" } }, initial: "s", states: { s: {} } };
  const p = createPlayer(toProgram(doc), { host: h.host });
  assert.equal(p.input("a.layout.width", 88), true);
  h.advance(1 / 60);
  assert.equal(p.values()["line.width"], 88);
});

test("continuous app inputs update mapped values and reject names the file does not read", () => {
  const h = fakeHost();
  const doc = {
    nudg: "0.5",
    targets: ["ring"],
    values: { "ring.scale": { map: "host.volume", from: [0, 1], to: [1, 1.6] } },
    initial: "active",
    states: { active: {} },
  };
  const p = createPlayer(toProgram(doc), { host: h.host });
  assert.deepEqual(p.runtime.requiredInputs(), ["host.volume"]);
  assert.equal(p.values()["ring.scale"], 1);
  assert.equal(p.input("host.unknown", 0.5), false);
  assert.equal(p.input("host.volume", 0.5), true);
  h.advance(1 / 60);
  assert.equal(p.values()["ring.scale"], 1.3);
});

test("onSettle: once per rest, after the toast is shown though its timer runs, and again after it hides", () => {
  const h = fakeHost();
  const settles: { t: number; state: string[] }[] = [];
  let t = 0;
  const toast = JSON.parse(readFileSync(new URL("../examples/toast.nudg.json", import.meta.url), "utf8"));
  const p = createPlayer(toProgram(toast), { host: h.host, onSettle: (state) => settles.push({ t, state }) });
  const run = (seconds: number) => {
    for (let i = 0; i < seconds * 60; i++) {
      h.advance(1 / 60);
      t += 1 / 60;
    }
  };
  run(0.5);
  assert.equal(settles.length, 0, "nothing moved yet");
  p.send("host.show");
  run(1.5);
  assert.equal(settles.length, 1, "settled while the dismiss timer still runs");
  assert.deepEqual(settles[0].state, ["shown"]);
  assert.ok(settles[0].t > 0.8 && settles[0].t < 1.6, `settled at ${settles[0].t}`);
  run(3);
  assert.equal(settles.length, 2, "and again once hidden");
  assert.deepEqual(settles[1].state, ["hidden"]);
  assert.equal(h.pending(), 0, "no frames once idle");
});

test("onSettle: the host may send events from inside it, even as its clock moves on", () => {
  const h = fakeHost();
  let late = 0;
  const host = { now: () => h.host.now() + late, frame: h.host.frame };
  let settles = 0;
  const p = createPlayer(toProgram(presets.toggle()), {
    host,
    onSettle: () => {
      settles++;
      // The page's clock has moved past the frame's time by the time the host reacts.
      late += 0.001;
      if (settles === 1) p.send("track.tap");
    },
  });
  p.send("track.tap");
  assert.doesNotThrow(() => {
    for (let i = 0; i < 240 && h.pending(); i++) h.advance(1 / 60);
  });
  assert.equal(settles, 2, "the event sent from the first settle moved and settled again");
});

test("onSettle: an interrupted motion reports only the rest after the interruption; a drag doesn't report", () => {
  const h = fakeHost();
  const settles: string[][] = [];
  const p = createPlayer(toProgram(presets.toggle()), { host: h.host, onSettle: (s) => settles.push(s) });
  p.send("track.tap");
  h.advance(0.05);
  p.send("track.tap");
  for (let i = 0; i < 120 && h.pending(); i++) h.advance(1 / 60);
  assert.deepEqual(settles, [["off"]]);

  const drag = JSON.parse(readFileSync(new URL("../examples/toggle-drag.nudg.json", import.meta.url), "utf8"));
  const d = createPlayer(toProgram(drag), { host: h.host, onSettle: (s) => settles.push(s) });
  settles.length = 0;
  d.send("track.dragstart");
  h.advance(1 / 60);
  assert.deepEqual(settles, [["dragging"]], "entering the drag state is a change that settles at once");
  for (let x = 1; x <= 15; x++) {
    d.input("track.drag.x", x);
    h.advance(1 / 60);
  }
  assert.equal(settles.length, 1, "following the finger is not motion to report");
  d.send("track.dragend");
  for (let i = 0; i < 120 && h.pending(); i++) h.advance(1 / 60);
  assert.deepEqual(settles.at(-1), ["on"]);
  assert.equal(settles.length, 2);
});

test("onSettle: a state change with nothing to move settles on the next frame; an unhandled event doesn't", () => {
  const h = fakeHost();
  const settles: string[][] = [];
  const doc = { nudg: "0.1", targets: ["a"], values: { "a.x": 0 }, initial: "one", states: { one: { when: { "a.tap": "two" } }, two: {} } };
  const p = createPlayer(toProgram(doc), { host: h.host, onSettle: (s) => settles.push(s) });
  assert.equal(p.send("a.down"), false);
  h.advance(1 / 60);
  assert.deepEqual(settles, []);
  p.send("a.tap");
  assert.deepEqual(settles, [], "not inside send");
  h.advance(1 / 60);
  assert.deepEqual(settles, [["two"]]);
});
