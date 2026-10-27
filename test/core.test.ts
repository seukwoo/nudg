import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { hexToOklab, oklabToHex } from "../src/core/color.ts";
import { compile, createRuntime, simulate } from "../src/index.ts";
import { compilePath } from "../src/node/load.ts";

const root = fileURLToPath(new URL("..", import.meta.url));

test("colors survive a round trip through OKLab", () => {
  for (const hex of ["#000000", "#ffffff", "#d1d5db", "#4ade80", "#f43f5e", "#12345680"]) {
    assert.equal(oklabToHex(hexToOklab(hex)), hex);
  }
  assert.equal(oklabToHex(hexToOklab("#fa0")), "#ffaa00");
});

test("examples compile with no diagnostics", () => {
  for (const name of readdirSync(`${root}examples`).filter((f) => f.endsWith(".nudg.json"))) {
    const { program, diagnostics } = compilePath(`${root}examples/${name}`);
    assert.deepEqual(diagnostics, [], name);
    assert.ok(program, name);
  }
});

test("the example catalog matches the files", () => {
  const catalog = JSON.parse(readFileSync(`${root}examples/index.json`, "utf8"));
  const categories = new Set(catalog.categories.map((c: { id: string }) => c.id));
  const files = readdirSync(`${root}examples`).filter((f) => f.endsWith(".nudg.json")).map((f) => f.replace(/\.nudg\.json$/, ""));
  assert.deepEqual([...new Set(catalog.examples.map((e: { id: string }) => e.id))].sort(), files.sort(), "every example file is cataloged once");
  for (const e of catalog.examples) {
    assert.ok(categories.has(e.category), `${e.id}: unknown category ${e.category}`);
    assert.ok(existsSync(`${root}examples/${e.html}`), `${e.id}: missing ${e.html}`);
    assert.ok(e.tags.length && e.summary && e.prompts.length, `${e.id}: needs tags, a summary and prompts`);
    const html = readFileSync(`${root}examples/${e.html}`, "utf8");
    const { program } = compilePath(`${root}examples/${e.id}.nudg.json`);
    for (const t of program!.targets) assert.ok(html.includes(`data-nudg="${t}"`), `${e.id}: ${e.html} has no element for ${t}`);
  }
});

test("every example belongs to one queryable semantic recipe", async () => {
  const examples = JSON.parse(readFileSync(`${root}examples/index.json`, "utf8")).examples;
  const recipes = JSON.parse(readFileSync(`${root}recipes/index.json`, "utf8")).recipes;
  const ids = new Set(examples.map((example: { id: string }) => example.id));
  const names = new Set<string>();
  for (const recipe of recipes) {
    if (recipe.starter !== null) {
      assert.ok(ids.has(recipe.starter), `${recipe.id}: unknown starter ${recipe.starter}`);
      assert.ok(recipe.examples.includes(recipe.starter), `${recipe.id}: starter is not in examples`);
      assert.ok(compilePath(`${root}examples/${recipe.starter}.nudg.json`).program, `${recipe.id}: starter does not compile`);
    }
    for (const name of [recipe.id, ...recipe.aliases].map((value: string) => value.toLowerCase().replace(/[_\s]+/g, "-"))) {
      assert.ok(!names.has(name), `${recipe.id}: duplicate name or alias ${name}`);
      names.add(name);
    }
    for (const id of recipe.examples) assert.equal(examples.find((example: { id: string }) => example.id === id)?.recipe, recipe.id, `${id}: catalog and recipe disagree`);
  }
  for (const example of examples) assert.ok(recipes.some((recipe: { id: string; examples: string[] }) => recipe.id === example.recipe && recipe.examples.includes(example.id)), `${example.id}: recipe not found`);

  const { findRecipe, formatRecipe, noStarter, recipeSource } = await import("../src/node/recipes.ts");
  assert.equal(findRecipe("video chat")?.id, "video-call");
  assert.equal(findRecipe("TOGGLE_SWITCH")?.id, "switch");
  assert.equal(findRecipe("pinch zoom")?.id, "image-viewer");
  // Every recipe has a starter today; a recipe without one still reads as a contract.
  const gapOnly = { ...findRecipe("menu")!, starter: null, examples: [], gaps: [{ capability: "stagger" as const, status: "missing" as const, need: "Items one after another." }] };
  assert.equal(recipeSource(gapOnly), undefined);
  assert.match(formatRecipe(gapOnly), /Starter: none/);
  assert.match(noStarter(gapOnly), /no starter.*stagger/s);
});

test("a file without a machine is a library", () => {
  const { program, motions, diagnostics } = compilePath(`${root}examples/motion/brand.nudg.json`);
  assert.equal(program, undefined);
  assert.deepEqual(diagnostics, []);
  assert.deepEqual([...motions.keys()], ["snappy", "fade", "pop", "shake"]);
});

test("platform motion libraries compile and define the common names", () => {
  const common = ["standard", "quick", "gentle", "playful", "fade"];
  for (const name of ["apple", "material-expressive", "material-standard"]) {
    const { program, motions, diagnostics } = compilePath(`${root}examples/motion/${name}.nudg.json`);
    assert.equal(program, undefined, `${name} is a library`);
    assert.deepEqual(diagnostics, [], name);
    for (const c of common) assert.ok(motions.has(c), `${name} defines ${c}`);
    const fade = motions.get("fade")!;
    assert.ok(fade.kind === "spring" && fade.damping >= 2 * Math.sqrt(fade.stiffness * fade.mass) - 1e-9, `${name}: fade never bounces`);
  }
  // The published numbers, as written.
  const apple = compilePath(`${root}examples/motion/apple.nudg.json`).motions;
  const snappy = apple.get("snappy")!;
  assert.ok(snappy.kind === "spring" && Math.abs(snappy.stiffness - (2 * Math.PI / 0.5) ** 2) < 1e-9 && Math.abs(snappy.damping - 2 * 0.85 * Math.sqrt(snappy.stiffness)) < 1e-9);
  const m3 = compilePath(`${root}examples/motion/material-expressive.nudg.json`).motions.get("spatial-default")!;
  assert.ok(m3.kind === "spring" && m3.stiffness === 380 && Math.abs(m3.damping - 2 * 0.8 * Math.sqrt(380)) < 1e-9);
});

test("imports report missing files, cycles and duplicate names", () => {
  const files: Record<string, unknown> = {
    "a.nudg.json": { nudg: "0.1", import: ["./b.nudg.json"], motions: { soft: { spring: { duration: 0.5 } } } },
    "b.nudg.json": { nudg: "0.1", import: ["./a.nudg.json"], motions: { soft: { spring: { duration: 0.4 } } } },
  };
  const read = (p: string) => (p in files ? JSON.stringify(files[p]) : undefined);
  const codes = (doc: unknown) =>
    compile({ path: "main.nudg.json", text: JSON.stringify(doc) }, read).diagnostics.map((d) => d.code);
  assert.deepEqual(codes({ nudg: "0.1", import: ["./missing.nudg.json"] }), ["import-not-found"]);
  assert.ok(codes({ nudg: "0.1", import: ["./a.nudg.json"] }).includes("import-cycle"));
  assert.ok(codes({ nudg: "0.1", import: ["./a.nudg.json"] }).includes("duplicate-motion"));
});

test("$schema is allowed at the top level and must be a string", () => {
  const codes = (doc: unknown) => compile({ path: "main.nudg.json", text: JSON.stringify(doc) }).diagnostics.map((d) => d.code);
  assert.deepEqual(codes({ $schema: "https://unpkg.com/@nudg/core@0.3/spec/nudg-0.3.schema.json", nudg: "0.1", motions: {} }), []);
  assert.deepEqual(codes({ $schema: 1, nudg: "0.1", motions: {} }), ["invalid-type"]);
});

test("time never goes backwards", () => {
  const { program } = compilePath(`${root}examples/toggle.nudg.json`);
  const rt = createRuntime(program!);
  rt.send("track.tap", 0.5);
  assert.throws(() => rt.sample(0.4), RangeError);
  assert.throws(() => rt.send("track.tap", 0.1), RangeError);
});

test("the initial state plays no entry effect", () => {
  const kick = compile({
    path: "main.nudg.json",
    text: JSON.stringify({
      nudg: "0.1",
      targets: ["heart"],
      values: { "heart.scale": 1 },
      initial: "liked",
      states: { liked: { enter: { "heart.scale": { kick: 6, spring: { duration: 0.4, bounce: 0.5 } } } } },
    }),
  }).program!;
  const keyframes = compile({
    path: "main.nudg.json",
    text: JSON.stringify({
      nudg: "0.8",
      targets: ["field"],
      values: { "field.x": 0 },
      initial: "invalid",
      states: {
        invalid: {
          enter: {
            "field.x": {
              keyframes: [{ at: 0.5, value: 12 }],
              duration: 0.4,
            },
          },
        },
      },
    }),
  }).program!;
  assert.equal(createRuntime(kick).sample(0.1)["heart.scale"], 1);
  assert.equal(createRuntime(keyframes).sample(0.1)["field.x"], 0);
});

test("simulate summarizes extremes and settle times", () => {
  const { program } = compilePath(`${root}examples/toggle.nudg.json`);
  const sim = simulate(program!, { events: [{ t: 0.1, event: "track.tap" }, { t: 0.2, event: "knob.tap" }] });
  const knob = sim.summary["knob.x"];
  assert.ok(Math.abs((knob.final as number) - 20) < 1e-3);
  assert.ok(knob.max! > 20 && knob.max! < 21, "a bounce of 0.25 overshoots a little");
  assert.ok(knob.settledAt! > 0.5 && knob.settledAt! < 1);
  assert.deepEqual(sim.unhandled, [{ t: 0.2, event: "knob.tap" }]);
  assert.equal(sim.samples[0].t, 0);
});

test("cli validate and simulate speak JSON", () => {
  const run = (...args: string[]) => execFileSync(process.execPath, [`${root}src/cli.ts`, ...args], { encoding: "utf8" });
  const validated = JSON.parse(run("validate", `${root}examples/toggle.nudg.json`, "--json"));
  assert.equal(validated.ok, true);
  const simulated = JSON.parse(run("simulate", `${root}examples/like.nudg.json`, "--send", "heart.tap@100ms", "--json"));
  assert.ok(simulated.summary["heart.scale"].max > 1.1);
  const recipe = JSON.parse(run("recipe", "video chat", "--json"));
  assert.equal(recipe.id, "video-call");
  assert.match(run("recipe", "toggle", "--source"), /"track\.dragend"/);
  assert.match(run("recipe", "pinch zoom", "--source"), /"image\.pinchstart"/);
  assert.deepEqual(JSON.parse(run("recipe", "--gaps", "--json")).gaps, []);
  assert.match(run("recipe", "--gaps"), /No gaps/);
});

test("upgrade raises a valid file to the latest format and keeps the rest of its text", async () => {
  const { upgradeText } = await import("../src/core/upgrade.ts");
  const text = '{\n  "nudg":  "0.3",\n  "note": "keep  this",\n  "targets": []\n}\n';
  assert.deepEqual(upgradeText(text), { from: "0.3", text: '{\n  "nudg":  "1.1",\n  "note": "keep  this",\n  "targets": []\n}\n' });
  assert.equal(upgradeText('{ "nudg": "1.1" }')?.text, '{ "nudg": "1.1" }');
  assert.equal(upgradeText('{ "targets": [] }'), undefined);
  assert.equal(upgradeText("not json"), undefined);

  const dir = mkdtempSync(join(tmpdir(), "nudg-upgrade-"));
  try {
    const run = (...args: string[]) => spawnSync(process.execPath, [`${root}src/cli.ts`, "upgrade", ...args], { encoding: "utf8" });
    const old = join(dir, "toggle.nudg.json");
    writeFileSync(old, readFileSync(`${root}spec/conformance/toggle-tap.json`, "utf8").replace(/[\s\S]*"doc": /, "").replace(/,\s*"steps"[\s\S]*/, ""));
    assert.equal(run(old, "--check").status, 1, "--check fails on an older file");
    assert.match(run(old).stdout, /0\.1 → 1\.1/);
    assert.equal(JSON.parse(readFileSync(old, "utf8")).nudg, "1.1");
    assert.equal(run(old, "--check").status, 0);
    const broken = join(dir, "broken.nudg.json");
    writeFileSync(broken, '{ "nudg": "0.1", "targets": ["a"], "initial": "missing", "states": {} }');
    assert.equal(run(broken).status, 1, "a file with errors is not upgraded");
    assert.equal(JSON.parse(readFileSync(broken, "utf8")).nudg, "0.1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("plot draws a labeled graph with overshoot and settle marks", async () => {
  const { plot } = await import("../src/core/plot.ts");
  const { program } = compilePath(`${root}examples/like.nudg.json`);
  const { svg, width, height } = plot(program!, { events: [{ t: 0.1, event: "heart.tap" }], title: "like" });
  assert.ok(svg.startsWith("<svg") && width > 0 && height > 0);
  assert.match(svg, /max 1\.209/);
  assert.match(svg, /at rest 0\.\d+s/);
  assert.match(svg, />liked</);
  assert.match(svg, /<desc>Events: heart\.tap @ 0\.1s\. heart\.scale: final/);
});

test("a drag gesture lands where the throw was heading", async () => {
  const { dragGesture } = await import("../src/core/simulate.ts");
  const { program } = compilePath(`${root}examples/toggle-drag.nudg.json`);
  const events = dragGesture("track", 0.1, 0.18, 9);
  assert.deepEqual(events.slice(0, 2), [
    { t: 0.1, event: "track.down", implied: true },
    { t: 0.1, event: "track.dragstart" },
  ]);
  assert.deepEqual(events.slice(-2).map((e) => "event" in e && e.event), ["track.up", "track.dragend"]);
  const quick = simulate(program!, { events });
  assert.equal(quick.samples.at(-1)!.state[0], "on", "a quick 9-unit flick crosses the midpoint");
  assert.deepEqual(quick.unhandled, [], "helper-added down and up aren't reported");
  // The same 9 units, but held still before the release: no velocity, so position decides.
  const held = [...dragGesture("track", 0.1, 0.3, 9).filter((e) => !("event" in e && e.t === 0.3)), { t: 0.5, event: "track.dragend" }];
  const slow = simulate(program!, { events: held });
  assert.equal(slow.samples.at(-1)!.state[0], "off", "a drag held short of the midpoint springs back");
});

test("timers fire in simulation at exactly their due time", () => {
  const { program } = compilePath(`${root}examples/toast.nudg.json`);
  const sim = simulate(program!, { events: [{ t: 0.1, event: "host.show" }], every: 0.1 });
  const at = (t: number) => sim.samples.find((s) => Math.abs(s.t - t) < 1e-9)!;
  assert.deepEqual(at(3.0).state, ["shown"]);
  assert.deepEqual(at(3.1).state, ["hidden"], "after:3s from 0.1 fires at 3.1");
  assert.equal(at(3.1).values["toast.opacity"], 1, "the fade starts at the due time");
  assert.ok((at(3.2).values["toast.opacity"] as number) < 1 && (at(3.4).values["toast.opacity"] as number) < 0.01);
  assert.ok(sim.summary["toast.opacity"].settledAt! > 3.1, "the simulation ran past the timer");
});

test("reduced motion makes every motion a short linear tween", () => {
  const { program } = compilePath(`${root}examples/toggle.nudg.json`);
  const sim = simulate(program!, { events: [{ t: 0, event: "track.tap" }], every: 0.075, reducedMotion: true });
  assert.equal(sim.samples[1].values["knob.x"], 10, "halfway through a 0.15 s linear tween");
  assert.equal(sim.samples[2].values["knob.x"], 20);
  assert.equal(sim.summary["knob.x"].max, 20, "no overshoot");
});

test("the runtime can start in other states, and rejects unknown paths", () => {
  const { program } = compilePath(`${root}examples/toggle-press.nudg.json`);
  const rt = createRuntime(program!, { state: ["checked/on"] });
  assert.deepEqual(rt.state(), ["checked/on", "press/up"]);
  assert.equal(rt.sample(0)["knob.x"], 20, "starts at the target, without animating");
  assert.throws(() => createRuntime(program!, { state: ["checked/onn"] }), /No state "onn"/);
});

test("presets are valid documents with the behavior their names promise", async () => {
  const { presets } = await import("../src/core/presets.ts");
  const compileDoc = (doc: object) => compile({ path: "preset.nudg.json", text: JSON.stringify(doc) });
  for (const [name, make] of Object.entries(presets)) {
    const { program, diagnostics } = compileDoc(make());
    assert.deepEqual(diagnostics, [], name);
    assert.ok(program, name);
  }
  const press = simulate(compileDoc(presets.press({ y: 6, scale: 1 })).program!, { events: [{ t: 0, event: "button.down" }, { t: 0.3, event: "button.up" }], every: 0.1 });
  assert.ok((press.samples[1].values["button.y"] as number) > 5.5, "sunk by 0.1 s");
  assert.ok(press.summary["button.y"].min! < 0, "and bounces back up");
  const toast = simulate(compileDoc(presets.toast({ duration: 1 })).program!, { events: [{ t: 0, event: "host.show" }], every: 0.5 });
  assert.deepEqual(toast.samples.map((s) => s.state[0]).slice(0, 4), ["shown", "shown", "hidden", "hidden"]);
  const hover = compileDoc(presets.hover({ target: "tile", lift: -8, scale: 1.02 })).program!;
  assert.deepEqual([...hover.properties.keys()], ["tile.y", "tile.scale"]);
});

test("compare says first whether a person would notice", async () => {
  const { compare } = await import("../src/core/compare.ts");
  const base = JSON.parse(readFileSync(`${root}examples/toggle.nudg.json`, "utf8"));
  const variant = (bounce: number) => {
    const doc = JSON.parse(JSON.stringify(base));
    doc.animate["knob.x"].spring.bounce = bounce;
    return compile({ path: "v.nudg.json", text: JSON.stringify(doc) }).program!;
  };
  const a = compile({ path: "a.nudg.json", text: JSON.stringify(base) }).program!;
  const events = [{ t: 0.05, event: "track.tap" }];

  const same = compare(a, a, { events });
  assert.equal(same.verdict, "imperceptible");
  assert.match(same.headline, /identically/);

  const tiny = compare(a, variant(0.26), { events });
  assert.equal(tiny.verdict, "imperceptible");
  assert.match(tiny.headline, /Nothing a person will notice/);
  assert.match(tiny.suggestion ?? "", /exaggerated/);

  const bouncier = compare(a, variant(0.4), { events });
  assert.equal(bouncier.verdict, "clear");
  assert.match(bouncier.headline, /clear change/);
  const knob = bouncier.properties.find((p) => p.property === "knob.x")!;
  assert.ok(knob.maxDifference > 1 && knob.overshoot![1] > knob.overshoot![0]);
  assert.equal(bouncier.properties.find((p) => p.property === "track.color")!.maxDifference, 0);
});

test("plot can overlay a second version", async () => {
  const { plot } = await import("../src/core/plot.ts");
  const base = compilePath(`${root}examples/toggle.nudg.json`).program!;
  const { svg } = plot(base, { events: [{ t: 0.05, event: "track.tap" }], against: base, labels: ["now", "later"] });
  assert.match(svg, /class="series against"/);
  assert.match(svg, />later</);
});

test("overshoot is measured per target leg, so a round trip without bounce reports 0", async () => {
  const { presets } = await import("../src/core/presets.ts");
  const doc = (release: object) => compile({ path: "p.nudg.json", text: JSON.stringify(presets.press({ y: 6, scale: 1, release })) }).program!;
  const events = [{ t: 0, event: "button.down" }, { t: 0.3, event: "button.cancel" }];
  const flat = simulate(doc({ duration: 0.6, bounce: 0 }), { events });
  assert.equal(flat.summary["button.y"].overshoot, 0);
  assert.ok(flat.summary["button.y"].max! > 5.9, "it did travel to 6 and back");
  const bouncy = simulate(doc({ duration: 0.3, bounce: 0.35 }), { events });
  assert.ok(bouncy.summary["button.y"].overshoot! > 0.2 && bouncy.summary["button.y"].overshoot! < 1, "the spring-back past 0 counts, the trip to 6 doesn't");
});

test("compare frame times include where the versions differ most", async () => {
  const { compare, compareFrameTimes } = await import("../src/core/compare.ts");
  const { presets } = await import("../src/core/presets.ts");
  const doc = (release: object) => compile({ path: "p.nudg.json", text: JSON.stringify(presets.press({ y: 6, scale: 1, release })) }).program!;
  const c = compare(doc({ duration: 0.3, bounce: 0.35 }), doc({ duration: 0.6, bounce: 0 }), { events: [{ t: 0, event: "button.down" }, { t: 0.3, event: "button.cancel" }] });
  const { times, marks } = compareFrameTimes(c, 4);
  const at = c.properties.find((p) => p.property === "button.y")!.at;
  assert.ok(times.includes(Math.round(at * 1000) / 1000), "the largest-difference moment is a frame");
  assert.ok(Object.values(marks).some((m) => m.includes("differs most")));
  assert.ok(times.includes(0.3) && times.includes(0.38), "the event and 80 ms after it are frames");
  assert.deepEqual(times, [...times].sort((x, y) => x - y));
});
