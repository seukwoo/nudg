// The JSON Schema serves editors and LLM structured output. It must accept every valid
// document and reject structural mistakes; reference checks are the validator's job.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";

const read = (url: URL) => JSON.parse(readFileSync(url, "utf8"));
const schema = read(new URL("../spec/nudg-1.0.schema.json", import.meta.url));
const schema04 = read(new URL("../spec/nudg-0.4.schema.json", import.meta.url));
const schema02 = read(new URL("../spec/nudg-0.2.schema.json", import.meta.url));
const schema01 = read(new URL("../spec/nudg-0.1.schema.json", import.meta.url));
const recipeSchema = read(new URL("../recipes/schema.json", import.meta.url));
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);

function valid(doc: unknown): boolean {
  return validate(doc) as boolean;
}

function filesIn(dir: URL): URL[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? filesIn(new URL(`${e.name}/`, dir)) : e.name.endsWith(".json") && e.name !== "index.json" ? [new URL(e.name, dir)] : [],
  );
}

test("the semantic recipe catalog matches its schema", () => {
  const validateRecipes = new Ajv2020({ allErrors: true, strict: false }).compile(recipeSchema);
  const catalog = read(new URL("../recipes/index.json", import.meta.url));
  assert.ok(validateRecipes(catalog), JSON.stringify(validateRecipes.errors, null, 2));
});

// Every older schema still compiles and accepts the conformance documents written for its version.
for (const [version, older] of [["0.1", schema01], ["0.2", schema02], ["0.4", schema04]] as const) {
  test(`the ${version} schema still compiles and accepts the ${version} documents`, () => {
    const validateOlder = new Ajv2020({ allErrors: true, strict: false }).compile(older);
    const docs = filesIn(new URL("../spec/conformance/", import.meta.url))
      .map((url) => read(url).doc)
      .filter((doc) => doc?.nudg === version);
    assert.ok(docs.length > 0, `conformance has ${version} documents`);
    for (const doc of docs) assert.ok(validateOlder(doc), JSON.stringify(validateOlder.errors));
  });
}

test("schema accepts every example", () => {
  for (const url of filesIn(new URL("../examples/", import.meta.url))) {
    assert.ok(valid(read(url)), `${url.pathname}: ${JSON.stringify(validate.errors, null, 2)}`);
  }
});

test("schema accepts every document in the conformance suite", () => {
  const dir = new URL("../spec/conformance/", import.meta.url);
  for (const url of filesIn(dir)) {
    // programs/ holds compiled forms, not nudg documents.
    if (url.pathname.includes("/programs/")) continue;
    const c = read(url);
    if (c.documents) continue;
    for (const doc of [c.doc, ...Object.values(c.files ?? {})]) {
      assert.ok(valid(doc), `${url.pathname}: ${JSON.stringify(validate.errors, null, 2)}`);
    }
  }
});

test("schema rejects structural mistakes", () => {
  const base = () => ({
    nudg: "0.1",
    targets: ["knob"],
    values: { "knob.x": 0 },
    initial: "off",
    states: { off: { when: { "knob.tap": "off" } } },
  });
  assert.ok(valid(base()));

  const cases: [string, (d: any) => void][] = [
    ["number version", (d) => (d.nudg = 0.1)],
    ["unknown top-level key", (d) => (d.motion = {})],
    ["unknown state key", (d) => (d.states.off.sett = {})],
    ["unknown property", (d) => (d.values["knob.translateX"] = 0)],
    ["unknown event", (d) => (d.states.off.when = { "knob.click": "off" })],
    ["color name", (d) => (d.values["knob.color"] = "green")],
    ["mixed spring forms", (d) => (d.animate = { "knob.x": { spring: { duration: 0.3, dampingRatio: 0.5 } } })],
    ["bounce of 1", (d) => (d.animate = { "knob.x": { spring: { duration: 0.3, bounce: 1 } } })],
    ["spring and tween", (d) => (d.animate = { "knob.x": { spring: { duration: 0.3 }, tween: { duration: 0.2 } } })],
    ["kick without spring", (d) => (d.states.off.enter = { "knob.x": { kick: 3, tween: { duration: 0.2 } } })],
    ["unknown ease", (d) => (d.animate = { "knob.x": { tween: { duration: 0.2, ease: "ease-out" } } })],
    ["states and regions", (d) => (d.regions = { a: { initial: "s", states: { s: {} } } })],
    ["missing initial", (d) => delete d.initial],
  ];
  for (const [name, mutate] of cases) {
    const doc = base();
    mutate(doc);
    assert.equal(valid(doc), false, `should reject: ${name}`);
  }
  const noted = base() as any;
  noted.note = "ok";
  noted.values.note = "base values";
  noted.states.off["x-vendor"] = { anything: true };
  noted.$schema = "https://unpkg.com/@nudg/core/spec/nudg-1.0.schema.json";
  assert.ok(valid(noted), `notes and x- extensions: ${JSON.stringify(validate.errors, null, 2)}`);
});
