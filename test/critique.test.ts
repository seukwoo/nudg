// The motion critique: each rule fires on a file that breaks it, and stays quiet on the examples.

import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { test } from "node:test";
import { compile } from "../src/core/compile.ts";
import { critique } from "../src/core/critique.ts";
import { compilePath } from "../src/node/load.ts";

const run = (doc: object) => {
  const { program, diagnostics } = compile({ path: "main.nudg.json", text: JSON.stringify(doc) });
  assert.ok(program, JSON.stringify(diagnostics));
  return critique(program!).findings;
};
const codes = (doc: object) => run(doc).map((f) => `${f.code} ${f.path}`);

const toggle = (spring: object) => ({
  nudg: "0.3",
  targets: ["knob", "track"],
  values: { "knob.x": 0 },
  animate: { "knob.x": { spring } },
  initial: "off",
  states: { off: { when: { "track.tap": "on" } }, on: { set: { "knob.x": 20 }, when: { "track.tap": "off" } } },
});

test("slow-transition: a toggle that takes over a second", () => {
  const f = run(toggle({ duration: 1.4, bounce: 0.3 }));
  assert.ok(f.some((x) => x.code === "slow-transition" && x.severity === "warning" && x.path === "/states/off/when/track.tap"), JSON.stringify(f));
  assert.deepEqual(run(toggle({ duration: 0.35, bounce: 0.25 })), [], "the example's toggle is fine");
});

test("late-feedback: a press that sinks slowly", () => {
  const doc = {
    nudg: "0.3",
    targets: ["button"],
    values: { "button.scale": 1 },
    animate: { "button.scale": { spring: { duration: 0.5, bounce: 0 } } },
    initial: "up",
    states: { up: { when: { "button.down": "down" } }, down: { set: { "button.scale": 0.94 }, when: { "button.up": "up" } } },
  };
  assert.ok(codes(doc).includes("late-feedback /states/up/when/button.down"), JSON.stringify(run(doc)));
});

test("invisible-change: a press of 0.5%", () => {
  const doc = {
    nudg: "0.3",
    targets: ["button"],
    values: { "button.scale": 1 },
    animate: { "button.scale": { spring: { duration: 0.12, bounce: 0 } } },
    initial: "up",
    states: { up: { when: { "button.down": "down" } }, down: { set: { "button.scale": 0.995 }, when: { "button.up": "up" } } },
  };
  assert.ok(codes(doc).includes("invisible-change /states/up/when/button.down"), JSON.stringify(run(doc)));
});

test("bouncy-fade, slow-exit and no-escape on a dialog", () => {
  const doc = {
    nudg: "0.3",
    targets: ["opener", "dialog", "close"],
    values: { "dialog.opacity": 0, "dialog.y": 24 },
    animate: { "dialog.opacity": { spring: { duration: 0.3, bounce: 0.5 } }, "dialog.y": { spring: { duration: 0.25, bounce: 0 } } },
    initial: "closed",
    states: {
      closed: { when: { "opener.tap": "open" } },
      open: { set: { "dialog.opacity": 1, "dialog.y": 0 }, when: { "close.tap": { to: "closed", animate: { "dialog.y": { spring: { duration: 0.9, bounce: 0 } } } } } },
    },
  };
  const c = codes(doc);
  assert.ok(c.includes("bouncy-fade /animate/dialog.opacity"), c.join("\n"));
  assert.ok(c.includes("slow-exit /states/open/when/close.tap"), c.join("\n"));
  assert.ok(c.includes("no-escape /states/open/when"), c.join("\n"));
  // With Escape, quick exits and a non-bouncy fade: nothing to say.
  const fixed = JSON.parse(JSON.stringify(doc));
  fixed.animate["dialog.opacity"] = { tween: { duration: 0.2, ease: "out" } };
  fixed.states.open.when["close.tap"] = "closed";
  fixed.states.open.when["dialog.key.escape"] = "closed";
  assert.deepEqual(codes(fixed), []);
});

test("short-timeout: a toast gone in 2 s with nothing to pause it", () => {
  const doc = {
    nudg: "0.3",
    targets: ["toast"],
    values: { "toast.y": 24 },
    animate: { "toast.y": { spring: { duration: 0.3, bounce: 0 } } },
    initial: "hidden",
    when: { "host.show": "shown" },
    states: { hidden: {}, shown: { set: { "toast.y": 0 }, when: { "after:2s": "hidden" } } },
  };
  assert.ok(codes(doc).includes("short-timeout /states/shown/when/after:2s"), JSON.stringify(run(doc)));
});

test("the curated examples are clean", () => {
  const all: string[] = [];
  for (const f of readdirSync("examples").filter((n) => n.endsWith(".nudg.json"))) {
    const { program } = compilePath(`examples/${f}`);
    for (const x of critique(program!).findings) all.push(`${f} ${x.code}`);
  }
  assert.deepEqual(all, []);
});
