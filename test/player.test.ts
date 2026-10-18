// The headless player: a runtime driven by a host's clock and frames, for non-DOM hosts.

import assert from "node:assert/strict";
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
