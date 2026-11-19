// Colors the app names (1.8) on a real page: read from CSS custom properties at bind, and
// again when the theme changes. Needs a local Chrome; skipped without one.

import assert from "node:assert/strict";
import { test } from "node:test";
import { findChrome } from "../src/node/chrome.ts";

const chrome = findChrome();

test("the DOM adapter reads named colors from CSS variables, follows a theme change, and takes colors from the app", { skip: chrome ? false : "no Chrome found" }, async () => {
  const { launchBrowser, waitFor } = await import("../src/node/cdp.ts");
  const { serveIfLocal } = await import("../src/node/observe.ts");
  const { url, close } = await serveIfLocal("test/fixtures/host/presence.html");
  const browser = await launchBrowser(chrome!);
  try {
    await browser.send("Page.navigate", { url });
    await waitFor(() => browser.evaluate("window.__player ? 'ready' : ''"), 15_000);
    const result = await browser.evaluate(`(async () => {
      const { playDoc } = await import("../../../dist/dom/index.js");
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const doc = {
        nudg: "1.8",
        host: { colors: { surface: { default: "#FFFFFF" }, hover: { default: "#E5E7EB" } } },
        targets: ["row"],
        values: { "row.color": { color: "surface" } },
        animate: { "row.color": { tween: { duration: 0.1, ease: "out" } } },
        initial: "idle",
        states: {
          idle: { when: { "row.hoverstart": "over" } },
          over: { set: { "row.color": { color: "hover" } }, when: { "row.hoverend": "idle" } },
        },
      };
      const style = document.createElement("style");
      style.textContent = ".light { --surface: #fafafa; --row-hover: rgb(229 231 235); } .dark .themed { --surface: oklch(0.2 0 0); --row-hover: hsl(240 4% 16%); }";
      document.head.append(style);
      document.documentElement.classList.add("light");
      const box = document.createElement("div");
      box.className = "themed";
      const row = document.createElement("div");
      box.append(row);
      document.body.append(box);
      const bg = () => getComputedStyle(row).backgroundColor;

      const p = playDoc(doc, row, { colors: { hover: "--row-hover" } });
      const atBind = bg();
      p.send("row.hoverstart");
      await wait(250);
      const hovered = bg();
      // The app switches the theme on <html>: the row moves to the dark hover color.
      document.documentElement.classList.replace("light", "dark");
      await wait(250);
      const darkHover = bg();
      p.send("row.hoverend");
      await wait(250);
      const darkSurface = bg();
      // A color the app supplies itself, as any CSS color, stays until it supplies another.
      const supplied = p.color("surface", "rebeccapurple");
      await wait(250);
      const purple = bg();
      document.documentElement.classList.replace("dark", "light");
      await wait(250);
      const stillPurple = bg();
      const unknown = p.color("nope", "red");
      const invalid = p.color("hover", "not a color");
      p.destroy();
      return { atBind, hovered, darkHover, darkSurface, supplied, purple, stillPurple, unknown, invalid };
    })()`);
    assert.equal(result.atBind, "rgb(250, 250, 250)", "the theme's color at bind, not the default");
    assert.equal(result.hovered, "rgb(229, 231, 235)", "a mapped variable, in any CSS color form");
    assert.equal(result.darkHover, "rgb(39, 39, 42)", "a theme change on <html> moves to the new color");
    assert.equal(result.darkSurface, "rgb(22, 22, 22)", "oklch() read as sRGB");
    assert.equal(result.supplied, true);
    assert.equal(result.purple, "rgb(102, 51, 153)");
    assert.equal(result.stillPurple, "rgb(102, 51, 153)", "a supplied color isn't read from CSS again");
    assert.equal(result.unknown, false);
    assert.equal(result.invalid, false);
  } finally {
    await browser.close();
    close();
  }
});

test("a component that switches its own theme with a class inside its root (a shadow root too) is followed", { skip: chrome ? false : "no Chrome found" }, async () => {
  const { launchBrowser, waitFor } = await import("../src/node/cdp.ts");
  const { serveIfLocal } = await import("../src/node/observe.ts");
  const { url, close } = await serveIfLocal("test/fixtures/host/presence.html");
  const browser = await launchBrowser(chrome!);
  try {
    await browser.send("Page.navigate", { url });
    await waitFor(() => browser.evaluate("window.__player ? 'ready' : ''"), 15_000);
    const result = await browser.evaluate(`(async () => {
      const { playDoc } = await import("../../../dist/dom/index.js");
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const host = document.createElement("div");
      document.body.append(host);
      const root = host.attachShadow({ mode: "open" });
      root.innerHTML = '<style>.app { --surface: #ffffff; } .app.dark { --surface: #111827; }</style><div class="app"><div data-nudg="row"></div></div>';
      const doc = {
        nudg: "1.8",
        host: { colors: { surface: { default: "#FFFFFF" } } },
        targets: ["row"],
        values: { "row.color": { color: "surface" } },
        animate: { "row.color": { tween: { duration: 0.1, ease: "out" } } },
        initial: "idle",
        states: { idle: {} },
      };
      const p = playDoc(doc, root);
      const row = root.querySelector('[data-nudg="row"]');
      const before = getComputedStyle(row).backgroundColor;
      root.querySelector(".app").classList.add("dark");
      await wait(250);
      const after = getComputedStyle(row).backgroundColor;
      p.destroy();
      return { before, after };
    })()`);
    assert.equal(result.before, "rgb(255, 255, 255)");
    assert.equal(result.after, "rgb(17, 24, 39)");
  } finally {
    await browser.close();
    close();
  }
});
