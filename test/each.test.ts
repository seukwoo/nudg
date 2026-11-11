// playEach: one file on every element that matches, bound on press or as elements appear.
// On a real page; skipped without Chrome.

import assert from "node:assert/strict";
import { test } from "node:test";
import { findChrome } from "../src/node/chrome.ts";

const chrome = findChrome();

test("playEach binds a press on the touch that lands, skips disabled controls, follows new elements and lets go of removed ones", { skip: chrome ? false : "no Chrome found" }, async () => {
  const { launchBrowser, waitFor } = await import("../src/node/cdp.ts");
  const { serveIfLocal } = await import("../src/node/observe.ts");
  const { url, close } = await serveIfLocal("test/fixtures/host/presence.html");
  const browser = await launchBrowser(chrome!);
  try {
    await browser.send("Page.navigate", { url });
    await waitFor(() => browser.evaluate("window.__player ? 'ready' : ''"), 15_000);
    const result = await browser.evaluate(`(async () => {
      const { playEach } = await import("../../../dist/dom/index.js");
      const { presets } = await import("../../../dist/index.js");
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const box = document.createElement("div");
      box.innerHTML = '<button id="a">A</button><button id="wide" style="width:300px">W</button><button id="off" disabled>D</button><div data-nudg-off><button id="opt">O</button></div>';
      document.body.append(box);
      const $ = (id) => document.getElementById(id);
      const scale = (el) => new DOMMatrix(getComputedStyle(el).transform).a;
      const down = (el) => el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, isPrimary: true, button: 0, pointerType: "touch" }));
      const up = (el) => el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, isPrimary: true, button: 0, pointerType: "touch" }));
      const soft = presets.press({ scale: 0.98 });
      const hard = presets.press({ scale: 0.9 });
      const each = playEach((el) => (el.offsetWidth >= 200 ? soft : hard), "button");

      const before = each.get($("a"));
      down($("a")); await wait(300);
      const a = scale($("a")); up($("a"));
      down($("wide")); await wait(300);
      const wide = scale($("wide")); up($("wide"));
      down($("off")); down($("opt")); await wait(300);
      const skipped = [scale($("off")), scale($("opt")), each.get($("off")), each.get($("opt"))].map(String);

      // A button added later presses too; a removed one's player is let go at the next press.
      const late = document.createElement("button"); late.textContent = "L"; box.append(late);
      const gone = $("a"); const goneP = each.get(gone); gone.remove();
      down(late); await wait(300);
      const lateScale = scale(late); up(late);
      let goneDone = false; await Promise.race([goneP.done.then(() => (goneDone = true)), wait(100)]);
      each.stop();
      const stopped = late.style.transform;

      // "mount": every match gets one as it appears, here a one-shot entrance.
      const list = document.createElement("div"); document.body.append(list);
      const tips = playEach(presets.pop(), ".tip", { root: list, when: "mount", start: "host.show", release: "settle" });
      const tip = document.createElement("span"); tip.className = "tip"; list.append(tip);
      await wait(50);
      const bound = Boolean(tips.get(tip));
      await wait(1500);
      const rested = tip.style.transform;
      tips.stop();
      return { before: String(before), a, wide, skipped, lateScale, goneDone, stopped, bound, rested };
    })()`);
    assert.equal(result.before, "undefined", "nothing is bound before a press");
    assert.ok(result.a < 0.95, `the first touch presses: ${result.a}`);
    assert.ok(result.wide > 0.97 && result.wide < 1, `a variant by element: ${result.wide}`);
    assert.deepEqual(result.skipped, ["1", "1", "undefined", "undefined"]);
    assert.ok(result.lateScale < 0.95, `a button added later presses: ${result.lateScale}`);
    assert.equal(result.goneDone, true, "a removed element's player is let go");
    assert.equal(result.stopped, "", "stop puts the styles back");
    assert.equal(result.bound, true, "mount binds elements as they appear");
    assert.equal(result.rested, "", "a one-shot lets go at rest");
  } finally {
    await browser.close();
    close();
  }
});
