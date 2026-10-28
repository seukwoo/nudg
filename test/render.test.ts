// Needs a local Chrome; skipped without one.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { findChrome } from "../src/node/chrome.ts";
import { renderFrames } from "../src/node/render.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const chrome = findChrome();

test("render captures real frames as one PNG", { skip: chrome ? false : "no Chrome found" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "nudg-test-"));
  try {
    const out = join(dir, "like.png");
    const result = await renderFrames({
      file: `${root}examples/like.nudg.json`,
      html: `${root}examples/like.html`,
      events: [{ t: 0.05, event: "heart.tap" }],
      times: [0, 0.1, 0.3],
      out,
      chrome: chrome!,
    });
    assert.ok(existsSync(out));
    assert.deepEqual(readFileSync(out).subarray(1, 4).toString(), "PNG");
    assert.deepEqual(result.frames.map((f) => f.state), [["idle"], ["liked"], ["liked"]]);
    assert.deepEqual(result.unbound, []);
    assert.deepEqual(result.unknown, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("compare page plays both versions offline, with press-both and slow motion", { skip: chrome ? false : "no Chrome found" }, async () => {
  const { comparePage, readWithImports } = await import("../src/node/compare-page.ts");
  const { launchBrowser } = await import("../src/node/cdp.ts");
  const a = readWithImports(join(root, "examples/button-press.nudg.json"));
  const b = { ...a, text: a.text.replace('"button.scale": 0.94', '"button.scale": 0.8') };
  assert.notEqual(a.text, b.text);
  const page = comparePage({
    html: readFileSync(join(root, "examples/button-press.html"), "utf8"),
    a,
    b,
    labels: ["now", "deeper"],
    events: [{ t: 0.05, event: "button.down" }, { t: 0.35, event: "button.cancel" }],
    until: 1,
    headline: "A clear change.",
  });
  // The runtime travels with the page: no network needed.
  assert.ok(!page.includes("unpkg.com"), "runtime is inlined when dist/ is built");
  assert.ok(page.includes("data:text/javascript;base64"));
  const dir = mkdtempSync(join(tmpdir(), "nudg-page-"));
  const file = join(dir, "compare.html");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(file, page);
  const browser = await launchBrowser(chrome!);
  const errors: string[] = [];
  try {
    await browser.send("Runtime.enable");
    browser.on("Runtime.exceptionThrown", (p) => errors.push(p.exceptionDetails.exception?.description ?? p.exceptionDetails.text));
    await browser.send("Page.navigate", { url: `file://${file}` });
    // Navigation returns before the document is committed; wait until the page is playing.
    const { waitFor } = await import("../src/node/cdp.ts");
    await waitFor(async () => {
      const t = await browser.evaluate(`document.getElementById("time")?.textContent ?? ""`);
      return t && t !== "0.00s" ? t : undefined;
    }, 15_000);
    // Press both at ¼× with a 1 s hold, then look mid-hold: A sits at 0.94, B at 0.80.
    await browser.evaluate(`document.querySelector('[data-hold="1"]').click(); document.querySelector('[data-speed="0.25"]').click(); document.getElementById("press-both").click()`);
    await new Promise((r) => setTimeout(r, 1500));
    const mid = await browser.evaluate(`({
      time: Number(document.getElementById("time").textContent.replace("s", "")),
      a: document.getElementById("values-a").textContent,
      b: document.getElementById("values-b").textContent,
      state: document.querySelector("#stage-b [data-nudg]").getAttribute("data-nudg-state"),
    })`);
    assert.ok(mid.time > 0.2 && mid.time < 0.8, `slow motion: ${mid.time}s of page time after 1.5 s`);
    assert.equal(mid.state, "down");
    assert.match(mid.a, /button\.scale 0\.9[45]/);
    assert.match(mid.b, /button\.scale 0\.8[01]/);
    await browser.evaluate(`document.getElementById("pause").click()`);
    const t1 = await browser.evaluate(`document.getElementById("time").textContent`);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(await browser.evaluate(`document.getElementById("time").textContent`), t1, "pause holds time");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("compare page: a tap on one stage happens on both", { skip: chrome ? false : "no Chrome found" }, async () => {
  const { comparePage, readWithImports } = await import("../src/node/compare-page.ts");
  const { launchBrowser, waitFor } = await import("../src/node/cdp.ts");
  const a = readWithImports(join(root, "examples/toggle.nudg.json"));
  const b = { ...a, text: a.text.replace('"bounce": 0.25', '"bounce": 0.6') };
  assert.notEqual(a.text, b.text);
  const page = comparePage({ html: readFileSync(join(root, "examples/toggle.html"), "utf8"), a, b, labels: ["now", "bouncier"], events: [], until: 1, headline: "x" });
  const dir = mkdtempSync(join(tmpdir(), "nudg-page-"));
  const file = join(dir, "compare.html");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(file, page);
  const browser = await launchBrowser(chrome!);
  try {
    await browser.send("Page.navigate", { url: `file://${file}` });
    const state = (stage: string) => browser.evaluate(`document.querySelector("#${stage} [data-nudg=track]")?.getAttribute("data-nudg-state") ?? ""`);
    await waitFor(async () => (await state("stage-b")) || undefined, 15_000);
    assert.equal(await state("stage-b"), "off");
    // A click is a tap; it comes from the page on A, and B gets it too.
    await browser.evaluate(`document.querySelector("#stage-a [data-nudg=track]").click()`);
    await waitFor(async () => ((await state("stage-b")) === "on" ? true : undefined), 5_000);
    assert.equal(await state("stage-a"), "on");
    await browser.evaluate(`document.querySelector("#stage-b [data-nudg=track]").click()`);
    await waitFor(async () => ((await state("stage-a")) === "off" ? true : undefined), 5_000);
    assert.equal(await state("stage-b"), "off", "no echo: B toggled once");
  } finally {
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("compare page survives </script> in a note and presses the target the file lets you press", async () => {
  const { comparePage, readWithImports } = await import("../src/node/compare-page.ts");
  const a = readWithImports(join(root, "examples/toggle.nudg.json"));
  const b = { ...a, text: a.text.replace('"note": "', '"note": "see the </script> tag <!-- here -->; ') };
  assert.notEqual(a.text, b.text);
  const page = comparePage({ html: readFileSync(join(root, "examples/toggle.html"), "utf8"), a, b, labels: ["A", "B"], events: [{ t: 0.05, event: "track.tap" }], until: 1, headline: "x" });
  assert.ok(!/<\/script>\s*tag/.test(page), "the note's </script> must not end the module");
  assert.ok(page.includes("\\u003c/script>"));
  // The toggle's knob moves but the track is tapped: press both goes to the track.
  assert.ok(page.includes('const pressTarget = "track"'));
});

test("readWithImports keys nested imports the way the page's compiler asks for them", async () => {
  const { readWithImports } = await import("../src/node/compare-page.ts");
  const dir = mkdtempSync(join(tmpdir(), "nudg-imports-"));
  try {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(join(dir, "ui", "motion"), { recursive: true });
    writeFileSync(join(dir, "ui", "motion", "base.nudg.json"), JSON.stringify({ nudg: "0.1", motions: { snappy: { spring: { duration: 0.3, bounce: 0.2 } } } }));
    writeFileSync(join(dir, "ui", "motion", "brand.nudg.json"), JSON.stringify({ nudg: "0.1", import: ["./base.nudg.json"], motions: { pop: { kick: 6, spring: { duration: 0.4, bounce: 0.5 } } } }));
    writeFileSync(join(dir, "ui", "like.nudg.json"), JSON.stringify({ nudg: "0.1", import: ["./motion/brand.nudg.json"], targets: ["heart"], values: { "heart.scale": 1 }, animate: { "heart.scale": "snappy" }, initial: "idle", states: { idle: { when: { "heart.tap": "liked" } }, liked: { enter: { "heart.scale": "pop" }, when: { "heart.tap": "idle" } } } }));
    const read = readWithImports(join(dir, "ui", "like.nudg.json"));
    assert.deepEqual(Object.keys(read.files).sort(), ["motion/base.nudg.json", "motion/brand.nudg.json"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
