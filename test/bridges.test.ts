// nudg on real component libraries: MUI's TransitionComponent and Radix's data-state,
// bundled with esbuild and played in Chrome. Skipped without a local Chrome.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { before, test } from "node:test";
import { launchBrowser, waitFor } from "../src/node/cdp.ts";
import { findChrome } from "../src/node/chrome.ts";
import { serveIfLocal } from "../src/node/observe.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const chrome = findChrome();
const skip = chrome ? false : "no Chrome found";

before(() => {
  if (!chrome) return;
  execFileSync(`${root}node_modules/.bin/esbuild`, ["test/fixtures/bridges/app.ts", "--bundle", "--format=iife", "--outfile=test/fixtures/bridges/app.bundle.js", "--define:process.env.NODE_ENV=\"production\"", "--log-level=error"], { cwd: root });
});

test("MUI Dialog with nudgTransition: springs in, stays mounted through the exit, then unmounts", { skip }, async () => {
  const { url, close } = await serveIfLocal("test/fixtures/bridges/index.html");
  const browser = await launchBrowser(chrome!);
  const errors: string[] = [];
  try {
    await browser.send("Runtime.enable");
    browser.on("Runtime.exceptionThrown", (p) => errors.push(p.exceptionDetails.exception?.description ?? p.exceptionDetails.text));
    await browser.send("Page.navigate", { url });
    await waitFor(() => browser.evaluate("window.__app ? 'ready' : ''"), 15_000);
    const scaleOf = `(() => { const el = document.querySelector(".MuiDialog-container"); if (!el) return null; const m = getComputedStyle(el).transform; const a = m.match(/matrix\\(([^,]+)/); return a ? Number(a[1]) : 1; })()`;

    await browser.evaluate("window.__app.setMui(true)");
    await new Promise((r) => setTimeout(r, 60));
    const early = await browser.evaluate(scaleOf);
    assert.ok(early !== null && early < 1, `opening starts small: ${early}`);
    await new Promise((r) => setTimeout(r, 800));
    assert.ok(Math.abs((await browser.evaluate(scaleOf)) - 1) < 0.005, "at rest open");

    await browser.evaluate("window.__app.setMui(false)");
    await new Promise((r) => setTimeout(r, 60));
    assert.ok((await browser.evaluate(scaleOf)) !== null, "still mounted while the exit plays");
    await waitFor(() => browser.evaluate(`document.querySelector(".MuiDialog-container") ? "" : "gone"`), 3_000);

    // Radix Switch: data-state drives the knob.
    await browser.evaluate(`document.getElementById("switch").click()`);
    await new Promise((r) => setTimeout(r, 700));
    const x = await browser.evaluate(`new DOMMatrix(getComputedStyle(document.getElementById("thumb")).transform).m41`);
    assert.ok(Math.abs(x - 20) < 0.5, `knob at ${x}`);
    assert.equal(await browser.evaluate(`document.getElementById("switch").getAttribute("data-state")`), "checked");

    // Radix Dialog: data-state open/closed, present until the exit settles.
    await browser.evaluate("window.__app.setRadix(true)");
    await new Promise((r) => setTimeout(r, 700));
    const opacity = () => browser.evaluate(`Number(getComputedStyle(document.getElementById("radix-content")).opacity)`);
    assert.ok(Math.abs((await opacity()) - 1) < 0.01);
    await browser.evaluate("window.__app.setRadix(false)");
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(await browser.evaluate(`getComputedStyle(document.getElementById("radix-content")).visibility`), "visible", "visible while leaving");
    await waitFor(() => browser.evaluate(`getComputedStyle(document.getElementById("radix-content")).visibility === "hidden" ? "hidden" : ""`), 3_000);
    assert.ok((await opacity()) < 0.01);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    close();
  }
});

test("useNudg input: applies a value given before mount, follows updates, and survives a program change", { skip }, async () => {
  const { url, close } = await serveIfLocal("test/fixtures/bridges/index.html");
  const browser = await launchBrowser(chrome!);
  try {
    await browser.send("Page.navigate", { url });
    await waitFor(() => browser.evaluate("window.__app ? 'ready' : ''"), 15_000);
    const x = () => browser.evaluate(`new DOMMatrix(getComputedStyle(document.getElementById("fill")).transform).m41`);
    const settle = () => new Promise((r) => setTimeout(r, 100));

    assert.equal(await browser.evaluate("window.__early"), true, "accepted before the player exists");
    await settle();
    assert.ok(Math.abs((await x()) - 25) < 0.5, `early value applied: ${await x()}`);

    assert.equal(await browser.evaluate(`window.__app.meter.input("host.level", 0.5)`), true);
    assert.equal(await browser.evaluate(`window.__app.meter.input("host.unknown", 1)`), false, "names the file doesn't read");
    await settle();
    assert.ok(Math.abs((await x()) - 50) < 0.5, `follows updates: ${await x()}`);

    await browser.evaluate("window.__app.setSpan(200)");
    await settle();
    assert.ok(Math.abs((await x()) - 100) < 0.5, `kept across the program change: ${await x()}`);
  } finally {
    await browser.close();
    close();
  }
});
