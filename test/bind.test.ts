// How playDoc binds a root element, on a real page. Needs a local Chrome; skipped without one.

import assert from "node:assert/strict";
import { test } from "node:test";
import { findChrome } from "../src/node/chrome.ts";

const chrome = findChrome();

test("playDoc binds the root to the first target unless a [data-nudg] in it names one of the file's targets", { skip: chrome ? false : "no Chrome found" }, async () => {
  const { launchBrowser, waitFor } = await import("../src/node/cdp.ts");
  const { serveIfLocal } = await import("../src/node/observe.ts");
  const { url, close } = await serveIfLocal("test/fixtures/host/presence.html");
  const browser = await launchBrowser(chrome!);
  try {
    await browser.send("Page.navigate", { url });
    await waitFor(() => browser.evaluate("window.__player ? 'ready' : ''"), 15_000);
    const result = await browser.evaluate(`(async () => {
      const { playDoc } = await import("../../../dist/dom/index.js");
      const { presets } = await import("../../../dist/index.js");
      const warnings = [];
      const warn = console.warn;
      console.warn = (m) => warnings.push(m);
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const make = (html) => {
        const el = document.createElement("div");
        el.innerHTML = html;
        document.body.append(el);
        return el.firstElementChild;
      };
      const pressed = async (p, el) => {
        p.send("button.down");
        await wait(250);
        const scale = new DOMMatrix(getComputedStyle(el).transform).a;
        p.destroy();
        return scale;
      };

      // A row that holds another player's part (a switch's knob): the row itself is pressed.
      const row = make('<button>Dark mode <span data-nudg="knob"></span></button>');
      const a = playDoc(presets.press(), row);
      const rowCase = { unbound: a.unbound, scale: await pressed(a, row), knob: row.querySelector("span").style.transform };

      // A root whose part names the file's target: the part is bound, as before.
      const card = make('<div><button data-nudg="button">Go</button></div>');
      const b = playDoc(presets.press(), card);
      const inner = card.querySelector("button");
      const partCase = { unbound: b.unbound, scale: await pressed(b, inner), root: card.style.transform };

      console.warn = warn;
      return { rowCase, partCase, warnings };
    })()`);
    assert.deepEqual(result.rowCase.unbound, []);
    assert.ok(result.rowCase.scale < 0.99, `the row is pressed: scale ${result.rowCase.scale}`);
    assert.equal(result.rowCase.knob, "", "the other player's knob is left alone");
    assert.deepEqual(result.partCase.unbound, []);
    assert.ok(result.partCase.scale < 0.99, `the part is pressed: scale ${result.partCase.scale}`);
    assert.equal(result.partCase.root, "", "the root itself is not bound");
    assert.deepEqual(result.warnings, []);
  } finally {
    await browser.close();
    close();
  }
});
