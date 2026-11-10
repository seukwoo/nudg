// One-shots: a player that starts by itself and lets go at rest (`start`, `release`), the
// pop, drop and shake presets, and React's useNudgOnce. On a real page; skipped without Chrome.

import assert from "node:assert/strict";
import { test } from "node:test";
import { findChrome } from "../src/node/chrome.ts";

const chrome = findChrome();

async function onPage<T>(script: string, before?: string): Promise<T> {
  const { launchBrowser, waitFor } = await import("../src/node/cdp.ts");
  const { serveIfLocal } = await import("../src/node/observe.ts");
  const { url, close } = await serveIfLocal("test/fixtures/host/presence.html");
  const browser = await launchBrowser(chrome!);
  try {
    await browser.send("Page.navigate", { url });
    await waitFor(() => browser.evaluate("window.__player ? 'ready' : ''"), 15_000);
    if (before) await browser.evaluate(before);
    return (await browser.evaluate(script)) as T;
  } finally {
    await browser.close();
    close();
  }
}

test("start plays on bind, release lets go at rest and puts back the element's styles, done resolves", { skip: chrome ? false : "no Chrome found" }, async () => {
  const result = await onPage<any>(`(async () => {
    const { playDoc } = await import("../../../dist/dom/index.js");
    const { presets } = await import("../../../dist/index.js");
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const el = document.createElement("div");
    el.style.transform = "translateX(5px)";
    document.body.append(el);
    let released = false;
    const p = playDoc(presets.pop(), el, { start: "host.show", release: "settle" });
    p.done.then(() => (released = true));
    await wait(80);
    const during = { transform: el.style.transform, opacity: Number(getComputedStyle(el).opacity) };
    await Promise.race([p.done, wait(3000)]);
    const after = { transform: el.style.transform, opacity: el.style.opacity, released, sends: p.send("host.show") };

    // A shake: each host.shake plays it; release: "settle" lets go after the first one.
    const field = document.createElement("input");
    document.body.append(field);
    const xs = [];
    const s = playDoc(presets.shake(), field, { start: "host.shake", release: "settle", onFrame: (v) => xs.push(v["content.x"]) });
    await Promise.race([s.done, wait(3000)]);
    const shake = { min: Math.min(...xs), max: Math.max(...xs), transform: field.style.transform };

    // release: "exit" needs exit states.
    let error = "";
    try { playDoc(presets.pop(), el, { release: "exit" }); } catch (e) { error = e.message; }
    return { during, after, shake, error };
  })()`);
  assert.match(result.during.transform, /^translateX\(5px\) translate/, "the element's own transform stays outermost while it plays");
  assert.ok(result.during.opacity > 0 && result.during.opacity <= 1);
  assert.deepEqual(result.after, { transform: "translateX(5px)", opacity: "", released: true, sends: false });
  assert.ok(result.shake.min <= -9 && result.shake.max >= 8, `it shook: ${result.shake.min} to ${result.shake.max}`);
  assert.equal(result.shake.transform, "");
  assert.match(result.error, /needs `exit`/);
});

test("useNudgOnce plays on mount, again when replay changes, and lets go at rest", { skip: chrome ? false : "no Chrome found" }, async () => {
  const { build } = await import("esbuild");
  const entry = `
    import { createElement, useState } from "react";
    import { createRoot } from "react-dom/client";
    import { flushSync } from "react-dom";
    import { useNudgOnce, presets } from "./src/react/index.ts";
    let bump;
    function Count() {
      const [n, setN] = useState(3);
      bump = () => flushSync(() => setN((v) => v - 1));
      const ref = useNudgOnce(presets.pop(), { replay: [n] });
      return createElement("b", { ref, id: "n" }, n);
    }
    window.__once = { mount() { const div = document.createElement("div"); document.body.append(div); flushSync(() => createRoot(div).render(createElement(Count))); }, bump: () => bump() };
  `;
  const out = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: "ts" }, bundle: true, format: "iife", write: false, define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent" });
  const bundle = out.outputFiles[0].text;
  const result = await onPage<any>(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    window.__once.mount();
    const el = document.getElementById("n");
    const first = Number(getComputedStyle(el).opacity);
    await wait(1500);
    const rested = el.style.transform;
    window.__once.bump();
    const replayed = Number(getComputedStyle(el).opacity);
    await wait(1500);
    return { first, rested, replayed, text: el.textContent, end: el.style.transform };
  })()`, bundle);
  assert.equal(result.first, 0, "the first frame is the way in's start, not the end");
  assert.equal(result.rested, "", "it lets go at rest");
  assert.equal(result.replayed, 0, "a changed replay value plays it again");
  assert.equal(result.text, "2");
  assert.equal(result.end, "");
});
