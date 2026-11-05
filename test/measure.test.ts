// When the DOM adapter measures what a file reads, on a real page. Needs a local Chrome; skipped without one.

import assert from "node:assert/strict";
import { test } from "node:test";
import { findChrome } from "../src/node/chrome.ts";

const chrome = findChrome();

test("an element bound after the player starts is measured at once: a sheet opened right away rises from its measured height", { skip: chrome ? false : "no Chrome found" }, async () => {
  const { launchBrowser, waitFor } = await import("../src/node/cdp.ts");
  const { serveIfLocal } = await import("../src/node/observe.ts");
  const { url, close } = await serveIfLocal("test/fixtures/host/presence.html");
  const browser = await launchBrowser(chrome!);
  try {
    await browser.send("Page.navigate", { url });
    await waitFor(() => browser.evaluate("window.__player ? 'ready' : ''"), 15_000);
    const ys = await browser.evaluate(`(async () => {
      const { compileUrl, play } = await import("../../../dist/dom/index.js");
      const { program } = await compileUrl("../../../examples/bottom-sheet.nudg.json");
      const sheet = document.createElement("div");
      sheet.style.cssText = "position: fixed; left: 0; right: 0; bottom: 0; height: 300px; background: #ddd";
      document.body.append(sheet);
      // The way React binds: the player first, then the element (a ref), then the app's
      // effect sends the event, all before the first frame.
      const p = play(program, null);
      p.bind("sheet", sheet);
      const y = () => new DOMMatrix(getComputedStyle(sheet).transform).f;
      const bound = y();
      p.send("opener.tap");
      const ys = [bound];
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 80));
        ys.push(y());
      }
      p.destroy();
      return ys;
    })()`);
    assert.ok(Math.abs(ys[0] - 300) < 1, `bound, the closed sheet is already below the screen: ${ys[0]}`);
    assert.ok(ys[1] > 160 && ys[1] < 300, `it rises: ${ys}`);
    assert.ok(Math.abs(ys.at(-1) - 155) < 6, `and settles at half: ${ys}`);
  } finally {
    await browser.close();
    close();
  }
});
