// Host truth on real pages. Needs a local Chrome; skipped without one.

import assert from "node:assert/strict";
import { test } from "node:test";
import { actionsToEvents, decomposeMatrix, judgeHost, summarizeHost, type HostSeries } from "../src/core/observe.ts";
import { simulate } from "../src/core/simulate.ts";
import { findChrome } from "../src/node/chrome.ts";
import { compilePath } from "../src/node/load.ts";
import { observe } from "../src/node/observe.ts";

const chrome = findChrome();

function series(points: [number, number][], marks: { t: number; action: string }[] = [], unmountedAt?: number): HostSeries {
  const samples = points.map(([t, scale]) => ({ t, present: unmountedAt === undefined || t < unmountedAt, values: (unmountedAt !== undefined && t >= unmountedAt ? {} : { scale, x: 0 }) as Record<string, number> }));
  return { samples, marks, unmountedAt };
}

test("summarizeHost: a held press has no overshoot, a bounce on release does", () => {
  const press: [number, number][] = [];
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    press.push([t, t < 0.1 ? 1 : t < 0.2 ? 1 - (t - 0.1) * 0.6 : t < 0.5 ? 0.94 : t < 0.6 ? 0.94 + (t - 0.5) * 0.6 : 1]);
  }
  const held = summarizeHost(series(press, [{ t: 0.1, action: "down" }, { t: 0.5, action: "up" }]));
  assert.equal(held.properties.scale.changed, true);
  assert.equal(held.properties.scale.overshoot, 0);
  assert.ok(Math.abs(held.properties.scale.min! - 0.94) < 0.01);
  assert.ok(held.properties.scale.settledAt! > 0.55 && held.properties.scale.settledAt! < 0.65);
  assert.deepEqual(held.still, ["x"]);

  const bounce = press.map(([t, v]): [number, number] => [t, t > 0.6 && t < 0.7 ? 1.02 : t >= 0.7 && t < 0.8 ? 1.01 : v]);
  const bounced = summarizeHost(series(bounce, [{ t: 0.1, action: "down" }, { t: 0.5, action: "up" }]));
  assert.ok(Math.abs(bounced.properties.scale.overshoot! - 0.02) < 0.001, `overshoot ${bounced.properties.scale.overshoot}`);
});

test("judgeHost: played, never shown, nothing moved", () => {
  const { program } = compilePath("examples/button-press.nudg.json");
  const sim = simulate(program!, { events: [{ t: 0.1, event: "button.down" }, { t: 0.5, event: "button.up" }], until: 1.2 });
  const pts: [number, number][] = [];
  for (let i = 0; i <= 72; i++) pts.push([i / 60, sim.samples.reduce((best, s) => (Math.abs(s.t - i / 60) < Math.abs(best.t - i / 60) ? s : best)).values["button.scale"] as number]);
  const played = judgeHost(sim, summarizeHost(series(pts, [{ t: 0.1, action: "down" }, { t: 0.5, action: "up" }])), { target: "button" });
  assert.equal(played.verdict, "played", played.headline);

  const gone = judgeHost(sim, summarizeHost(series(pts, [{ t: 0.1, action: "down" }], 0.3)), { target: "button" });
  assert.equal(gone.verdict, "never-shown");
  assert.match(gone.headline, /left the page at 0\.30s, mid-motion/);

  const still = judgeHost(sim, summarizeHost(series(pts.map(([t]) => [t, 1]), [{ t: 0.1, action: "down" }])), { target: "button" });
  assert.equal(still.verdict, "nothing-moved");
  assert.match(still.headline, /Nothing moved on the page/);

  const slow = judgeHost(sim, summarizeHost(series(pts.map(([t, v]) => [t * 2, v]), [{ t: 0.2, action: "down" }])), { target: "button" });
  assert.equal(slow.verdict, "differs");
});

test("decomposeMatrix reads translate, scale and rotation", () => {
  const d = decomposeMatrix([0.94, 0, 0, 0.94, 0, 6]);
  assert.ok(Math.abs(d.scaleX - 0.94) < 1e-9 && Math.abs(d.scaleY - 0.94) < 1e-9 && d.y === 6 && d.rotation === 0);
  const r = decomposeMatrix([Math.cos(Math.PI / 4), Math.sin(Math.PI / 4), -Math.sin(Math.PI / 4), Math.cos(Math.PI / 4), 3, 0]);
  assert.ok(Math.abs(r.rotation - 45) < 1e-9 && Math.abs(r.scaleX - 1) < 1e-9 && r.x === 3);
});

test("actionsToEvents maps page actions to the file's events at the measured times", () => {
  assert.deepEqual(actionsToEvents("button", [{ t: 0.1, action: "down" }, { t: 0.18, action: "up" }, { t: 0.5, action: "key:Escape" }, { t: 0.6, action: "hover" }]), [
    { t: 0.1, event: "button.down" },
    { t: 0.18, event: "button.up" },
    { t: 0.18, event: "button.tap" },
    { t: 0.5, event: "button.key.escape" },
    { t: 0.6, event: "button.hoverstart" },
  ]);
});

test("observe measures a CSS press on a page that has nothing to do with nudg", { skip: chrome ? false : "no Chrome found" }, async () => {
  const o = await observe({ url: "test/fixtures/host/press-css.html", selector: "#btn", actions: [{ t: 0.1, action: "down" }, { t: 0.5, action: "up" }], chrome: chrome!, settle: 0.8 });
  const scale = o.summary.properties.scale;
  assert.equal(scale.changed, true);
  assert.ok(Math.abs(scale.min! - 0.9) < 0.01, `min ${scale.min}`);
  assert.ok(scale.settledAt! > 0.6 && scale.settledAt! < 0.85, `settled ${scale.settledAt}`);
  assert.equal(scale.overshoot, 0);
  assert.ok(o.summary.still.includes("opacity"));
  assert.ok(o.summary.frameInterval > 0.005 && o.summary.frameInterval < 0.04, `frame interval ${o.summary.frameInterval}`);
  assert.equal(o.series.unmountedAt, undefined);
  assert.deepEqual(o.series.marks.map((m) => m.action), ["down", "up"]);
});

test("observe sees an element leave the page mid-motion, and judges the file never shown", { skip: chrome ? false : "no Chrome found" }, async () => {
  const o = await observe({ url: "test/fixtures/host/unmount.html", selector: "#btn", actions: [{ t: 0.1, action: "tap" }], chrome: chrome!, settle: 0.6 });
  assert.ok(o.series.unmountedAt !== undefined && o.series.unmountedAt > 0.1 && o.series.unmountedAt < 0.5, `unmounted ${o.series.unmountedAt}`);
  assert.deepEqual(o.series.marks.map((m) => m.action), ["down", "up"]);
  const { program } = compilePath("examples/button-press.nudg.json");
  const sim = simulate(program!, { events: actionsToEvents("button", o.series.marks), until: 1.5 });
  const j = judgeHost(sim, o.summary, { target: "button" });
  assert.equal(j.verdict, "never-shown");
  assert.match(j.suggestion!, /mounted/);
});

test("observe judges a page that plays the file as played", { skip: chrome ? false : "no Chrome found" }, async () => {
  const o = await observe({ url: "examples/button-press.html", selector: '[data-nudg="button"]', actions: [{ t: 0.1, action: "down" }, { t: 0.5, action: "up" }], chrome: chrome!, settle: 1 });
  const { program } = compilePath("examples/button-press.nudg.json");
  const sim = simulate(program!, { events: actionsToEvents("button", o.series.marks), until: o.series.samples.at(-1)!.t });
  const j = judgeHost(sim, o.summary, { target: "button" });
  assert.equal(j.verdict, "played", j.headline + "\n" + j.properties.map((p) => p.summary).join("\n"));
  assert.ok(Math.abs(o.summary.properties.scale.min! - 0.94) < 0.005);
});
