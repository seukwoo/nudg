// The Vite plugin and what it relies on: presets built without the compiler, exactly as
// the compiler builds them; compiled imports; the compiler swapped out of the adapters.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { compile } from "../src/core/compile.ts";
import { lowerSimple } from "../src/core/lower.ts";
import { presets } from "../src/core/presets.ts";
import { programFromJson, programToJson } from "../src/core/program-json.ts";
import { simulate } from "../src/core/simulate.ts";
import { toProgram } from "../src/core/to-program-lean.ts";
import { nudg } from "../src/vite/index.ts";

const spring = { duration: 0.5, bounce: 0.4 };
const docs = [
  presets.press(), presets.press({ scale: 0.9, y: 2, sink: spring, release: spring }), presets.press({ scale: 1, y: 3, target: "card" }),
  presets.hover(), presets.hover({ lift: 0, scale: 1.05, motion: spring }), presets.hover({ lift: -8, scale: 1.02, target: "tile" }),
  presets.toggle(), presets.toggle({ colors: ["#d1d5db", "#4ade80cc"], travel: 24, initial: "on", motion: spring, knob: "k", track: "t" }),
  presets.toast(), presets.toast({ duration: 0 }), presets.toast({ duration: 1.5, rise: 20, motion: spring, target: "note" }),
  presets.appear(), presets.appear({ scale: 0.9, rise: 0, motion: spring, target: "menu" }),
];

test("presets are built without the compiler exactly as the compiler builds them", () => {
  for (const doc of docs) {
    const full = compile({ path: "p.nudg.json", text: JSON.stringify(doc) }).program!;
    const lite = lowerSimple(doc);
    assert.ok(lite, (doc as { note: string }).note);
    assert.deepEqual(programToJson(lite), programToJson(full), (doc as { note: string }).note);
    // And they play the same.
    const target = full.targets.at(-1)!;
    const events = [{ t: 0.1, event: `${target}.down` }, { t: 0.1, event: "host.show" }, { t: 0.2, event: `${target}.tap` }, { t: 0.5, event: `${target}.up` }];
    assert.deepEqual(simulate(lite, { events }).samples, simulate(full, { events }).samples);
  }
});

test("without the compiler, other documents say how to get it, and compiled programs pass", () => {
  const file = compile({ path: "x.nudg.json", text: JSON.stringify({ nudg: "1.1", targets: ["a"], values: { "a.x": 0 }, initial: "s", states: { s: { follow: { "a.x": { input: "a.drag.x" } } } } }) });
  assert.ok(file.program);
  assert.throws(() => toProgram({ nudg: "1.1", targets: ["a"], values: { "a.x": 0 }, initial: "s", states: { s: { follow: { "a.x": { input: "a.drag.x" } } } } }), /nudg\(\{ compiler: true \}\)/);
  const json = programToJson(file.program!) as object;
  assert.deepEqual(programToJson(toProgram(json)), json);
  assert.deepEqual(programToJson(programFromJson(json)), json);
});

test("the plugin compiles .nudg.json imports, fails on errors, and swaps the compiler out of the adapters", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nudg-vite-"));
  try {
    writeFileSync(join(dir, "brand.nudg.json"), JSON.stringify({ nudg: "1.1", motions: { soft: { spring: { duration: 0.4, bounce: 0.1 } } } }));
    writeFileSync(join(dir, "toggle.nudg.json"), JSON.stringify({ nudg: "1.1", import: ["./brand.nudg.json"], targets: ["knob", "track"], values: { "knob.x": 0 }, animate: { "knob.x": "soft" }, initial: "off", states: { off: { when: { "track.tap": "on" } }, on: { set: { "knob.x": 20 }, when: { "track.tap": "off" } } } }));
    writeFileSync(join(dir, "broken.nudg.json"), JSON.stringify({ nudg: "1.1", targets: ["a"], initial: "s", states: { s: { when: { "a.tapp": "s" } } } }));
    const watched: string[] = [];
    const context = {
      resolve: async (source: string, importer?: string) => ({ id: source.startsWith("/") ? source : join(importer ? join(importer, "..") : dir, source) }),
      addWatchFile: (id: string) => void watched.push(id),
      error: (message: string): never => {
        throw new Error(message);
      },
    };
    const plugin = nudg();
    assert.deepEqual(plugin.config(), { optimizeDeps: { exclude: ["@nudg/core"] } });
    const id = (await plugin.resolveId.call(context, "./toggle.nudg.json", join(dir, "App.tsx")))!;
    assert.match(id, /^\0nudg:.*toggle\.nudg\.json\.program\.js$/);
    const code = plugin.load.call(context, id)!;
    const program = programFromJson(JSON.parse(code.replace(/^export default /, "").replace(/;\n$/, "")));
    assert.equal(program.animate.get("knob.x")?.kind, "spring");
    assert.deepEqual(watched.map((p) => p.split("/").pop()).sort(), ["brand.nudg.json", "toggle.nudg.json"]);
    assert.throws(() => plugin.load.call(context, (id as string).replace("toggle", "broken")), /unknown-event at \/states\/s\/when\/a\.tapp/);
    assert.equal(plugin.load.call(context, "/src/App.tsx"), null);

    const adapter = "/app/node_modules/@nudg/core/dist/react/index.js";
    assert.equal(await plugin.resolveId.call(context, "../core/to-program.js", adapter), "/app/node_modules/@nudg/core/dist/core/to-program-lean.js");
    assert.equal(await plugin.resolveId.call(context, "./to-program.js", "/app/src/mine.ts"), null, "only the package's own imports");
    assert.equal(await nudg({ compiler: true }).resolveId.call(context, "../core/to-program.js", adapter), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
