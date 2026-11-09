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

test("destroy puts back the inline styles an element had; the system's reduced-motion setting is followed as it changes", { skip: chrome ? false : "no Chrome found" }, async () => {
  const { launchBrowser, waitFor } = await import("../src/node/cdp.ts");
  const { serveIfLocal } = await import("../src/node/observe.ts");
  const { url, close } = await serveIfLocal("test/fixtures/host/presence.html");
  const browser = await launchBrowser(chrome!);
  try {
    await browser.send("Page.navigate", { url });
    await waitFor(() => browser.evaluate("window.__player ? 'ready' : ''"), 15_000);
    const restored = await browser.evaluate(`(async () => {
      const { playDoc } = await import("../../../dist/dom/index.js");
      const { presets } = await import("../../../dist/index.js");
      const el = document.createElement("button");
      el.style.transform = "translateX(5px)";
      document.body.append(el);
      const p = playDoc(presets.press(), el);
      const during = el.style.transform;
      p.destroy();
      return { during, after: el.style.transform, opacity: el.style.opacity };
    })()`);
    assert.notEqual(restored.during, "translateX(5px)", "while bound, the player writes the transform");
    assert.equal(restored.after, "translateX(5px)", "after destroy, the page's own transform is back");
    assert.equal(restored.opacity, "");

    await browser.evaluate(`(async () => {
      const { compileUrl, play } = await import("../../../dist/dom/index.js");
      const { program } = await compileUrl("../../../examples/spinner.nudg.json");
      const el = document.createElement("div");
      el.id = "spin";
      document.body.append(el);
      window.__spin = play(program, null, { bind: { spinner: el } });
      window.__spin.send("host.start");
    })()`);
    const angle = () => browser.evaluate(`(() => { const m = new DOMMatrix(getComputedStyle(document.getElementById("spin")).transform); return Math.round(Math.atan2(m.b, m.a) * 180 / Math.PI); })()`);
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const spins = async () => {
      const a = await angle();
      await sleep(120);
      return a !== (await angle());
    };
    assert.ok(await spins(), "it spins");
    await browser.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await sleep(300);
    assert.equal(await angle(), 0, "reduced motion turned on: the turn comes back to rest");
    assert.ok(!(await spins()), "and stays still");
    await browser.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
    await sleep(100);
    assert.ok(await spins(), "turned off: it spins again, in the same state");
    assert.deepEqual(await browser.evaluate(`window.__spin.runtime.state()`), ["spinning"]);
  } finally {
    await browser.close();
    close();
  }
});

test("players on one element compose: the element's own transform stays outermost, transforms follow in bind order, opacities multiply", { skip: chrome ? false : "no Chrome found" }, async () => {
  const { launchBrowser, waitFor } = await import("../src/node/cdp.ts");
  const { serveIfLocal } = await import("../src/node/observe.ts");
  const { url, close } = await serveIfLocal("test/fixtures/host/presence.html");
  const browser = await launchBrowser(chrome!);
  try {
    await browser.send("Page.navigate", { url });
    await waitFor(() => browser.evaluate("window.__player ? 'ready' : ''"), 15_000);
    const r = await browser.evaluate(`(async () => {
      const { playDoc } = await import("../../../dist/dom/index.js");
      const { presets } = await import("../../../dist/index.js");
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const warnings = [];
      const warn = console.warn;
      console.warn = (m) => warnings.push(m);
      const css = document.createElement("style");
      css.textContent = ".badge { position: absolute; left: 200px; top: 300px; width: 40px; height: 20px; transform: translate(-50%, -50%); }";
      document.head.append(css);
      const centre = (el) => { const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; };
      const scaleOf = (el) => { const b = el.getBoundingClientRect(); return b.width / el.offsetWidth; };

      // A card that rises in and presses: both show.
      const card = document.createElement("div");
      card.style.cssText = "position: absolute; left: 20px; top: 400px; width: 100px; height: 60px";
      document.body.append(card);
      // Shown, it fades in and stays lifted 10 px, so a press that replaced its transform would drop it.
      const lift = { nudg: "1.1", targets: ["card"], values: { "card.y": 0, "card.opacity": 0 }, initial: "hidden",
        states: { hidden: { when: { "host.show": "shown" } }, shown: { set: { "card.y": -10, "card.opacity": 1 } } } };
      const appear = playDoc(lift, card);
      const press = playDoc(presets.press(), card);
      appear.send("host.show");
      await wait(900);
      const shown = { opacity: getComputedStyle(card).opacity, centre: centre(card) };
      press.send("button.down");
      await wait(300);
      const pressed = { scale: scaleOf(card), opacity: getComputedStyle(card).opacity, centre: centre(card) };
      press.send("button.up");
      appear.destroy();
      press.destroy();
      const released = card.style.transform + "|" + card.style.opacity;

      // A badge centred by its stylesheet presses about its own centre.
      const badge = document.createElement("div");
      badge.className = "badge";
      document.body.append(badge);
      const before = centre(badge);
      const p = playDoc(presets.press(), badge);
      p.send("button.down");
      await wait(300);
      const during = centre(badge);
      const badgeScale = scaleOf(badge);
      p.destroy();
      const after = { centre: centre(badge), inline: badge.style.transform };

      // React's first frame puts nudg's own transform inline; that is not the author's.
      const own = document.createElement("div");
      own.style.transform = "translate(0px, 24px) rotate(0deg) scale(1, 1)";
      document.body.append(own);
      const q = playDoc(presets.press(), own);
      const ownComposed = own.style.transform;
      q.destroy();

      // Two players writing a width: reported once.
      const box = document.createElement("div");
      document.body.append(box);
      const doc = (w) => ({ nudg: "1.1", targets: ["box"], values: { "box.width": w }, initial: "a", states: { a: {} } });
      const w1 = playDoc(doc(10), box);
      const w2 = playDoc(doc(20), box);
      const width = box.style.width;
      w1.destroy();
      w2.destroy();
      console.warn = warn;
      return { shown, pressed, released, before, during, badgeScale, after, ownComposed, width, warnings };
    })()`);
    assert.equal(r.shown.opacity, "1", "the card rose in");
    assert.ok(r.pressed.scale < 0.99, `and presses while shown: scale ${r.pressed.scale}`);
    assert.equal(r.pressed.opacity, "1", "the press doesn't undo the fade");
    assert.ok(Math.abs(r.pressed.centre[1] - r.shown.centre[1]) < 0.5, `nor the lift: ${r.shown.centre} → ${r.pressed.centre}`);
    assert.equal(r.released, "|", "once both let go, the card has no inline transform or opacity");
    assert.ok(r.badgeScale < 0.99, `the badge presses: scale ${r.badgeScale}`);
    assert.ok(Math.hypot(r.during[0] - r.before[0], r.during[1] - r.before[1]) < 0.5, `about its own centre: ${r.before} → ${r.during}`);
    assert.deepEqual(r.after.centre, r.before, "and is back in place after");
    assert.equal(r.after.inline, "", "its stylesheet transform is its own again");
    assert.equal(r.ownComposed, "translate(0px, 0px) rotate(0deg) scale(1, 1)", "nudg's own first-frame transform isn't kept as the author's");
    assert.equal(r.width, "20px", "the last player bound keeps a size");
    assert.equal(r.warnings.length, 1, `one warning for the shared width: ${r.warnings}`);
    assert.match(r.warnings[0], /two players write width/);
  } finally {
    await browser.close();
    close();
  }
});
