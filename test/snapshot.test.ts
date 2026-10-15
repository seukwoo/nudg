// Compare from a running page: snapshot the component, build the side-by-side page from
// it, and see it play. Needs a local Chrome; skipped without one.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { launchBrowser, waitFor } from "../src/node/cdp.ts";
import { findChrome, openInBrowser } from "../src/node/chrome.ts";
import { snapshotElement } from "../src/node/snapshot.ts";

const chrome = findChrome();

test("snapshotElement: the smallest element holding every target, styles inlined, motion left to the file", { skip: chrome ? false : "no Chrome found" }, async () => {
  const snap = await snapshotElement({ url: "examples/toggle.html", targets: ["knob", "track"], chrome: chrome! });
  assert.equal(snap.selector, '[data-nudg="track"]');
  assert.deepEqual(snap.bound, ["knob", "track"]);
  assert.ok(snap.markup.includes('data-nudg="knob"') && snap.markup.includes('data-nudg="track"'));
  assert.match(snap.markup, /background-color: rgb\(209, 213, 219\)/, "the track's color came along");
  assert.ok(!/style="[^"]*transform:/.test(snap.markup), "transform is the file's to drive");
  assert.ok(!snap.markup.includes("<script"));
  assert.ok(snap.html.includes("<base href="));
  assert.equal(snap.fidelity.elements, 2);
  await assert.rejects(snapshotElement({ url: "examples/toggle.html", targets: ["nothing"], chrome: chrome! }), /None of \[data-nudg="nothing"\] is on the page/);
});

test("nudg compare --url writes a page from the snapshot that plays both versions", { skip: chrome ? false : "no Chrome found" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "nudg-url-"));
  const b = join(dir, "toggle-bouncier.nudg.json");
  writeFileSync(b, readFileSync("examples/toggle.nudg.json", "utf8").replace(/"bounce":\s*[\d.]+/, '"bounce": 0.7'));
  const out = join(dir, "compare.html");
  const stdout = execFileSync(process.execPath, ["src/cli.ts", "compare", "examples/toggle.nudg.json", b, "--send", "track.tap@0.05", "--url", "examples/toggle.html", "--out", out], { encoding: "utf8", env: { ...process.env, NUDG_OPEN: "false" } });
  assert.match(stdout, /A clear change/);
  assert.match(stdout, /note: snapshot of \[data-nudg="track"\]: 2 elements/);
  assert.match(stdout, /wrote .*compare\.html/);
  const browser = await launchBrowser(chrome!);
  try {
    await browser.send("Page.navigate", { url: `file://${out}` });
    await waitFor(async () => ((await browser.evaluate(`document.getElementById("time")?.textContent ?? ""`)) !== "0.00s" ? "playing" : ""), 15_000);
    await new Promise((r) => setTimeout(r, 600));
    const states = await browser.evaluate(`["a", "b"].map((s) => document.querySelector("#stage-" + s + " [data-nudg=track]").getAttribute("data-nudg-state"))`);
    assert.deepEqual(states, ["on", "on"], "the scripted tap reached both snapshots");
  } finally {
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("openInBrowser respects NUDG_OPEN=false and never throws", () => {
  const before = process.env.NUDG_OPEN;
  process.env.NUDG_OPEN = "false";
  try {
    assert.equal(openInBrowser("/nonexistent.html"), false);
  } finally {
    if (before === undefined) delete process.env.NUDG_OPEN;
    else process.env.NUDG_OPEN = before;
  }
});
