// The 1.0 surface: what tools and hosts may depend on. Each list here is committed, and a
// change to it is a deliberate edit to the contract, never a side effect.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/** Codes the validator can report, by severity, read from the source. */
function sourceCodes(): Map<string, "error" | "warn"> {
  const out = new Map<string, "error" | "warn">();
  for (const file of readdirSync(new URL("../src/core/", import.meta.url)).filter((f) => f.endsWith(".ts") && f !== "critique.ts")) {
    const text = read(`src/core/${file}`);
    for (const m of text.matchAll(/\.(error|warn)\(\s*["`]([a-z0-9${}-]+)["`]/g)) {
      const severity = m[1] as "error" | "warn";
      for (const code of m[2] === "undeclared-host-${kind}" ? ["undeclared-host-event", "undeclared-host-input"] : [m[2]]) out.set(code, severity);
    }
    // Codes passed to the endpoint parser, which reports them for its caller.
    for (const m of text.matchAll(/parseEndpoint\([^;]*?"(invalid-[a-z-]+)"/g)) out.set(m[1], "error");
  }
  return out;
}

/** The codes docs/errors.md lists under a heading. */
function documented(section: string): string[] {
  const text = read("docs/errors.md");
  const body = text.split(`## ${section}\n`)[1].split("\n## ")[0];
  return [...body.matchAll(/^\| `([a-z0-9-]+)` \|/gm)].map((m) => m[1]);
}

test("every validator code is documented with its severity, and every documented code exists", () => {
  const codes = sourceCodes();
  const errors = [...codes].filter(([, s]) => s === "error").map(([c]) => c).sort();
  const warnings = [...codes].filter(([, s]) => s === "warn").map(([c]) => c).sort();
  assert.deepEqual(documented("Errors").sort(), errors);
  assert.deepEqual(documented("Warnings").sort(), warnings);
});

test("every critique code is documented", () => {
  const codes = [...new Set([...read("src/core/critique.ts").matchAll(/code: "([a-z-]+)"/g)].map((m) => m[1]))].sort();
  assert.deepEqual(documented("Critique findings").sort(), codes);
});

test("the public API matches api/ (run `npm run api` after a deliberate change)", async () => {
  const { apiSurface } = await import("../scripts/api.ts");
  for (const [name, text] of apiSurface()) assert.equal(text, read(`api/${name}`), `api/${name} is out of date`);
});
