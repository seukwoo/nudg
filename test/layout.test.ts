// Layout as input (0.4) on a real page: the DOM adapter measures, the file aligns and sizes.
// Needs a local Chrome; skipped without one.

import assert from "node:assert/strict";
import { test } from "node:test";
import { launchBrowser, waitFor } from "../src/node/cdp.ts";
import { findChrome } from "../src/node/chrome.ts";
import { serveIfLocal } from "../src/node/observe.ts";

const chrome = findChrome();

async function onPage<T>(page: string, fn: (evaluate: (expr: string) => Promise<any>) => Promise<T>): Promise<T> {
  const { url, close } = await serveIfLocal(page);
  const browser = await launchBrowser(chrome!);
  const errors: string[] = [];
  try {
    await browser.send("Runtime.enable");
    browser.on("Runtime.exceptionThrown", (p) => errors.push(p.exceptionDetails.exception?.description ?? p.exceptionDetails.text));
    await browser.send("Page.navigate", { url });
    await waitFor(() => browser.evaluate(`document.readyState === "complete" && document.querySelector("[data-nudg-state]") ? "ready" : ""`), 15_000);
    const out = await fn((e) => browser.evaluate(e));
    assert.deepEqual(errors, []);
    return out;
  } finally {
    await browser.close();
    close();
  }
}

const settle = () => new Promise((r) => setTimeout(r, 900));
const boxes = `(() => {
  const u = document.querySelector("[data-nudg=underline]").getBoundingClientRect();
  const tabs = [1, 2, 3].map((i) => document.querySelector("[data-nudg=tab" + i + "]").getBoundingClientRect());
  return { u: [u.left, u.width], tabs: tabs.map((r) => [r.left, r.width]) };
})()`;

test("tabs: the underline aligns with the tapped tab, takes its width, and follows a relabel", { skip: chrome ? false : "no Chrome found" }, async () => {
  await onPage("examples/tabs.html", async (evaluate) => {
    await settle();
    let b = await evaluate(boxes);
    assert.ok(Math.abs(b.u[0] - b.tabs[0][0]) < 0.5 && Math.abs(b.u[1] - b.tabs[0][1]) < 0.5, `first: ${JSON.stringify(b)}`);
    await evaluate(`document.querySelector("[data-nudg=tab2]").click()`);
    await settle();
    b = await evaluate(boxes);
    assert.ok(Math.abs(b.u[0] - b.tabs[1][0]) < 0.5 && Math.abs(b.u[1] - b.tabs[1][1]) < 0.5, `second: ${JSON.stringify(b)}`);
    // A longer label: the tab grows, the adapter re-measures, the underline follows.
    await evaluate(`document.querySelector("[data-nudg=tab2]").textContent = "Following everyone you know"`);
    await settle();
    b = await evaluate(boxes);
    assert.ok(b.tabs[1][1] > 150, "the tab grew");
    assert.ok(Math.abs(b.u[1] - b.tabs[1][1]) < 0.5, `relabel: ${JSON.stringify(b)}`);
  });
});

test("accordion: opens to the panel's natural height, measured", { skip: chrome ? false : "no Chrome found" }, async () => {
  await onPage("examples/accordion.html", async (evaluate) => {
    await settle();
    const closed = await evaluate(`document.querySelector("[data-nudg=panel]").offsetHeight`);
    assert.equal(closed, 0);
    await evaluate(`document.querySelector("[data-nudg=header]").click()`);
    await settle();
    const [h, natural] = await evaluate(`[document.querySelector("[data-nudg=panel]").offsetHeight, document.querySelector("[data-nudg=panel]").scrollHeight]`);
    assert.ok(h > 40 && Math.abs(h - natural) <= 1, `open ${h} vs natural ${natural}`);
  });
});

test("elements bound after the player starts (React refs) are measured too", { skip: chrome ? false : "no Chrome found" }, async () => {
  await onPage("examples/tabs.html", async (evaluate) => {
    const result = await evaluate(`(async () => {
      const { compileUrl, play } = await import("../dist/dom/index.js");
      const { program } = await compileUrl("./tabs.nudg.json");
      const host = document.createElement("div");
      host.innerHTML = '<div style="position:relative;display:flex;gap:10px"><button>A</button><button>Longer B</button><button>C</button><div style="position:absolute;left:0;bottom:0;height:2px"></div></div>';
      document.body.append(host);
      const [a, b, c, u] = host.querySelectorAll("button, div > div");
      const p = play(program, null, { clock: "manual" });
      const missingBefore = p.runtime.unmeasured().length;
      p.bind("tab1", a); p.bind("tab2", b); p.bind("tab3", c); p.bind("underline", u);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      p.render(0.01);
      const missingAfter = p.runtime.unmeasured().length;
      const width = p.values()["underline.width"];
      p.destroy();
      return { missingBefore, missingAfter, width, aWidth: a.offsetWidth };
    })()`);
    assert.ok(result.missingBefore > 0);
    assert.equal(result.missingAfter, 0);
    assert.equal(result.width, result.aWidth);
  });
});

test("a referenced scroll input is reported by the DOM adapter", { skip: chrome ? false : "no Chrome found" }, async () => {
  await onPage("examples/scroll-header.html", async (evaluate) => {
    const before = await evaluate(`document.querySelector("[data-nudg=header]").offsetHeight`);
    assert.equal(before, 64);
    await evaluate(`document.querySelector("[data-nudg=scroller]").scrollTop = 80`);
    await new Promise((r) => setTimeout(r, 100));
    const after = await evaluate(`document.querySelector("[data-nudg=header]").offsetHeight`);
    assert.equal(after, 40);
  });
});
