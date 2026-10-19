// Runs the language-neutral conformance suite in spec/conformance against this runtime.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { compile, createRuntime, type Program, type Value } from "../src/index.ts";
import { programFromJson, programToJson } from "../src/core/program-json.ts";

const NUMBER_TOLERANCE = 1e-6;
/** Colors may differ by one step per 8-bit channel after rounding. */
const COLOR_TOLERANCE = 1;

interface Step {
  t: number;
  send?: string;
  input?: string;
  value?: number;
  handled?: boolean;
  expect?: { state?: string[]; values?: Record<string, Value> };
}

interface Case {
  name: string;
  doc: unknown;
  start?: string[];
  reducedMotion?: boolean;
  files?: Record<string, unknown>;
  steps?: Step[];
  documents?: { name: string; doc: unknown; files?: Record<string, unknown>; errors: { code: string; path: string }[] }[];
}

const dir = new URL("../spec/conformance/", import.meta.url);

function compileCase(doc: unknown, files: Record<string, unknown> = {}) {
  return compile({ path: "main.nudg.json", text: JSON.stringify(doc) }, (path) =>
    path in files ? JSON.stringify(files[path]) : undefined,
  );
}

function assertValue(key: string, actual: Value | undefined, expected: Value, t: number) {
  if (typeof expected === "number") {
    assert.equal(typeof actual, "number", `${key} at ${t}s should be a number`);
    assert.ok(Math.abs((actual as number) - expected) <= NUMBER_TOLERANCE, `${key} at ${t}s: expected ${expected}, got ${actual}`);
    return;
  }
  assert.equal(typeof actual, "string", `${key} at ${t}s should be a color`);
  const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const a = channels(actual as string);
  const e = channels(expected);
  assert.ok(a.every((c, i) => Math.abs(c - e[i]) <= COLOR_TOLERANCE), `${key} at ${t}s: expected ${expected}, got ${actual}`);
}

for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
  const c: Case = JSON.parse(readFileSync(new URL(file, dir), "utf8"));

  if (c.documents) {
    describe(`${file}: ${c.name}`, () => {
      for (const d of c.documents!) {
        test(d.name, () => {
          const errors = compileCase(d.doc, d.files)
            .diagnostics.filter((x) => x.severity === "error")
            .map((x) => ({ code: x.code, path: x.path }));
          const key = (x: { code: string; path: string }) => `${x.code} ${x.path}`;
          assert.deepEqual(errors.map(key).sort(), d.errors.map(key).sort());
        });
      }
    });
    continue;
  }

  const run = (program: Program) => {
    const rt = createRuntime(program, { state: c.start, reducedMotion: c.reducedMotion });
    for (const step of c.steps ?? []) {
      if (step.input !== undefined) assert.ok(rt.input(step.input, step.value!, step.t), `input ${step.input} at ${step.t}s`);
      if (step.send !== undefined) {
        const handled = rt.send(step.send, step.t);
        if (step.handled !== undefined) assert.equal(handled, step.handled, `${step.send} at ${step.t}s handled`);
      }
      // Asking for time t fires any timers due by then, so advance before reading the state.
      const values = step.expect ? rt.sample(step.t) : undefined;
      if (step.expect?.state) assert.deepEqual(rt.state(), step.expect.state, `state at ${step.t}s`);
      if (step.expect?.values && values) {
        for (const [key, expected] of Object.entries(step.expect.values)) assertValue(key, values[key], expected, step.t);
      }
    }
  };

  test(`${file}: ${c.name}`, () => {
    const { program, diagnostics } = compileCase(c.doc, c.files);
    assert.ok(program, `document should compile: ${JSON.stringify(diagnostics, null, 2)}`);
    run(program);
  });

  // The compiled form other runtimes read must carry everything: the same case, through JSON.
  test(`${file} (compiled program JSON): ${c.name}`, () => {
    const { program } = compileCase(c.doc, c.files);
    run(programFromJson(JSON.parse(JSON.stringify(programToJson(program!)))));
  });
}

test("programs/ holds every case compiled by the current compiler (run spec/conformance/compile-programs.ts)", async () => {
  const { compiledPrograms } = await import("../spec/conformance/compile-programs.ts");
  for (const [name, text] of compiledPrograms()) {
    assert.equal(readFileSync(new URL(`programs/${name}`, dir), "utf8"), text, `programs/${name} is out of date`);
  }
});

test("compiled programs from before 0.6 default measurement arithmetic to identity", () => {
  const c: Case = JSON.parse(readFileSync(new URL("layout-tabs.json", dir), "utf8"));
  const { program } = compileCase(c.doc);
  const json = programToJson(program!) as any;
  delete json.properties.find((p: any) => p.measure).measure.times;
  delete json.properties.find((p: any) => p.measure).measure.plus;
  const stateEntry = json.machine.states.flatMap((s: any) => s.measure).find((m: any) => m);
  delete stateEntry.times;
  delete stateEntry.plus;
  const decoded = programFromJson(json);
  const measure = [...decoded.properties.values()].find((p) => p.measure)?.measure;
  assert.equal(measure?.times, 1);
  assert.equal(measure?.plus, 0);
  assert.equal(decoded.machine.kind, "states");
  if (decoded.machine.kind === "states") {
    const stateMeasure = [...decoded.machine.states.values()].flatMap((s) => [...s.measure.values()])[0];
    assert.equal(stateMeasure.times, 1);
    assert.equal(stateMeasure.plus, 0);
  }
});
