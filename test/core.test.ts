import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
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
  for (const name of readdirSync(`${root}examples`).filter((f) => f.endsWith(".json"))) {
    const { program, diagnostics } = compilePath(`${root}examples/${name}`);
    assert.deepEqual(diagnostics, [], name);
    assert.ok(program, name);
  }
});

test("a file without a machine is a library", () => {
  const { program, motions, diagnostics } = compilePath(`${root}examples/motion/brand.nudg.json`);
  assert.equal(program, undefined);
  assert.deepEqual(diagnostics, []);
  assert.deepEqual([...motions.keys()], ["snappy", "fade", "pop", "shake"]);
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

test("time never goes backwards", () => {
  const { program } = compilePath(`${root}examples/toggle.nudg.json`);
  const rt = createRuntime(program!);
  rt.send("track.tap", 0.5);
  assert.throws(() => rt.sample(0.4), RangeError);
  assert.throws(() => rt.send("track.tap", 0.1), RangeError);
});

test("the initial state plays no kick", () => {
  const { program } = compile({
    path: "main.nudg.json",
    text: JSON.stringify({
      nudg: "0.1",
      targets: ["heart"],
      values: { "heart.scale": 1 },
      initial: "liked",
      states: { liked: { enter: { "heart.scale": { kick: 6, spring: { duration: 0.4, bounce: 0.5 } } } } },
    }),
  });
  assert.equal(createRuntime(program!).sample(0.1)["heart.scale"], 1);
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
