// Exits: the element stays until the exit motion has settled. Needs a local Chrome; skipped without one.

import assert from "node:assert/strict";
import { test } from "node:test";
import { findChrome } from "../src/node/chrome.ts";
import { observe } from "../src/node/observe.ts";

const chrome = findChrome();

test("a tap dismisses the toast, and the element leaves only once hidden has settled", { skip: chrome ? false : "no Chrome found" }, async () => {
  const o = await observe({ url: "test/fixtures/host/presence.html", selector: ".toast", actions: [{ t: 0.2, action: "tap" }], chrome: chrome!, settle: 1.2 });
  const y = o.summary.properties.y;
  assert.equal(y.changed, true, "the toast moved down on dismiss");
  assert.ok(Math.abs((y.final as number) - 24) < 0.5, `the exit motion reached its end on screen: final y ${y.final}`);
  // The spring overshoots a little past 24 (bounce 0.25) and comes back before the element goes.
  assert.ok(y.max! >= 24 && y.max! < 27, `max y ${y.max}`);
  assert.ok(o.series.unmountedAt !== undefined, "the element was removed in the end");
  assert.ok(o.series.unmountedAt! > 0.28 + 0.3, `removed at ${o.series.unmountedAt}, after the spring had time to settle`);
  assert.ok((o.summary.properties.opacity.final as number) < 0.01, "faded out before removal");
});

test("present() and onExit: once per exit, not on mount in the exit state, true again when shown", { skip: chrome ? false : "no Chrome found" }, async () => {
  const { launchBrowser, waitFor } = await import("../src/node/cdp.ts");
  const { serveIfLocal } = await import("../src/node/observe.ts");
  const { url, close } = await serveIfLocal("test/fixtures/host/presence.html");
  const browser = await launchBrowser(chrome!);
  try {
    await browser.send("Page.navigate", { url });
    await waitFor(() => browser.evaluate("window.__player ? 'ready' : ''"), 15_000);
    const result = await browser.evaluate(`(async () => {
      const { compileUrl, play } = await import("../../../dist/dom/index.js");
      const { program } = await compileUrl("../../../examples/toast.nudg.json");
      const el = document.createElement("div");
      document.body.append(el);
      const log = [];
      const p = play(program, null, { bind: { toast: el }, state: ["hidden"], exit: "hidden", onExit: () => log.push("exit") });
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const mounted = { present: p.present(), exits: log.length };
      p.send("host.show");
      await wait(600);
      const shown = { present: p.present(), exits: log.length };
      p.send("host.hide");
      const justHidden = { present: p.present(), exits: log.length };
      await wait(900);
      const hidden = { present: p.present(), exits: log.length };
      p.send("host.show");
      await wait(50);
      const again = { present: p.present(), exits: log.length };
      p.destroy();
      return { mounted, shown, justHidden, hidden, again };
    })()`);
    assert.deepEqual(result.mounted, { present: true, exits: 0 }, "mounting in hidden is not an exit");
    assert.deepEqual(result.shown, { present: true, exits: 0 });
    assert.deepEqual(result.justHidden, { present: true, exits: 0 }, "still present while the exit motion plays");
    assert.deepEqual(result.hidden, { present: false, exits: 1 });
    assert.deepEqual(result.again, { present: true, exits: 1 });
  } finally {
    await browser.close();
    close();
  }
});
