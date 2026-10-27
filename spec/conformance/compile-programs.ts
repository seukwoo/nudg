// Writes programs/<case>.program.json: each behavior case's document compiled by the
// reference compiler, for runtimes that read compiled programs (Swift, Kotlin) instead
// of porting the validator. Also programs/toggle-bouncier.compare.json, a comparison
// bundle the native players are tested with. Run: node spec/conformance/compile-programs.ts
// The test suite fails if these are out of date.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { compare, compareBundle } from "../../src/core/compare.ts";
import { compile } from "../../src/core/compile.ts";
import { programToJson } from "../../src/core/program-json.ts";

const dir = new URL("./", import.meta.url);
const out = new URL("./programs/", dir);

export function compiledPrograms(): Map<string, string> {
  const result = new Map<string, string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const c = JSON.parse(readFileSync(new URL(file, dir), "utf8"));
    if (!c.doc) continue;
    const files: Record<string, unknown> = c.files ?? {};
    const { program, diagnostics } = compile({ path: "main.nudg.json", text: JSON.stringify(c.doc) }, (p) => (p in files ? JSON.stringify(files[p]) : undefined));
    if (!program) throw new Error(`${file} doesn't compile: ${JSON.stringify(diagnostics)}`);
    result.set(file.replace(/\.json$/, ".program.json"), JSON.stringify(programToJson(program), null, 1) + "\n");
  }
  // The toggle against a bouncier version of itself, tapped at 0.1 s.
  const doc = JSON.parse(readFileSync(new URL("toggle-tap.json", dir), "utf8")).doc;
  const bouncier = { ...doc, animate: { ...doc.animate, "knob.x": { spring: { duration: 0.35, bounce: 0.6 } } } };
  const [a, b] = [doc, bouncier].map((d) => compile({ path: "toggle.nudg.json", text: JSON.stringify(d) }).program!);
  const options = { events: [{ t: 0.1, event: "track.tap" }] };
  result.set("toggle-bouncier.compare.json", JSON.stringify(compareBundle(compare(a, b, options), a, b, options, ["now", "bouncier"]), null, 1) + "\n");
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  mkdirSync(out, { recursive: true });
  for (const [name, text] of compiledPrograms()) writeFileSync(new URL(name, out), text);
  console.log(`wrote ${compiledPrograms().size} programs`);
}
