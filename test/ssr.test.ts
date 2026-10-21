// Server rendering: the first frame as CSS without a DOM, the same in React's style(name)
// and in initialStyles(), so a hydrated page starts where the server left it.
// Hydration itself runs in Chrome in test/bridges.test.ts.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { toProgram } from "../src/core/player.ts";
import { cssText, initialStyles } from "../src/dom/style.ts";
import { useNudg } from "../src/react/index.ts";

const example = (name: string) => JSON.parse(readFileSync(new URL(`../examples/${name}.nudg.json`, import.meta.url), "utf8"));

test("initialStyles: the starting state, without a DOM", () => {
  const styles = initialStyles(toProgram(example("toast")));
  assert.deepEqual(styles.toast, { transform: "translate(0px, 24px) rotate(0deg) scale(1, 1)", opacity: "0" });
  assert.equal(cssText(styles.toast), "transform: translate(0px, 24px) rotate(0deg) scale(1, 1); opacity: 0");
  const shown = initialStyles(toProgram(example("toast")), { state: ["shown"] });
  assert.equal(shown.toast.opacity, "1", "a given starting state, with no entry motion");
});

test("initialStyles: app inputs the server knows; others start at 0", () => {
  const program = toProgram(example("microphone"));
  assert.match(initialStyles(program).level.transform!, /scale\(0, 1\)/);
  assert.match(initialStyles(program, { inputs: { "host.volume": 0.5 } }).level.transform!, /scale\(0\.5, 1\)/);
});

test("useNudg on the server: style(name) puts the first frame in the markup, inputs included", () => {
  function Toast() {
    const { bind, style } = useNudg(example("toast"));
    return h("div", { ref: bind("toast"), style: style("toast") }, "Saved");
  }
  const html = renderToString(h(Toast));
  assert.match(html, /style="transform:translate\(0px, 24px\) rotate\(0deg\) scale\(1, 1\);opacity:0"/);

  function Meter() {
    const { bind, style } = useNudg(example("microphone"), { inputs: { "host.volume": 0.5 } });
    return h("div", { ref: bind("level"), style: style("level") });
  }
  assert.match(renderToString(h(Meter)), /scale\(0\.5, 1\)/);
});
