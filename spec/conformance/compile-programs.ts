// Writes programs/<case>.program.json: each behavior case's document compiled by the
// reference compiler, for runtimes that read compiled programs (Swift, Kotlin) instead
// of porting the validator. Run: node spec/conformance/compile-programs.ts
// The test suite fails if these are out of date.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  mkdirSync(out, { recursive: true });
  for (const [name, text] of compiledPrograms()) writeFileSync(new URL(name, out), text);
  console.log(`wrote ${compiledPrograms().size} programs`);
}
