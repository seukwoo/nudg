// What a document becomes before it plays: a Program passes through, a compiled program
// (`nudg compile`, or a .nudg.json the Vite plugin compiled) is read, and a document (a
// preset, a parsed file) is compiled here. The adapters reach the compiler only through
// this module, so the Vite plugin can put to-program-lean.ts in its place.

import { compile } from "./compile.ts";
import { programFromJson } from "./program-json.ts";
import type { Program } from "./types.ts";

/** Compiles a document (with the files it imports) or passes a Program through; throws with every error. */
export function toProgram(source: Program | object, files: Record<string, unknown> = {}): Program {
  if ("machine" in source && (source as Program).properties instanceof Map) return source as Program;
  if ("nudgProgram" in source) return programFromJson(source);
  // The compiler asks for normalized paths ("motion/brand.nudg.json"); accept keys as people write imports.
  const byPath = new Map(Object.entries(files).map(([key, value]) => [key.replace(/^(\.\/)+/, ""), value]));
  const { program, diagnostics } = compile({ path: "main.nudg.json", text: JSON.stringify(source) }, (path) =>
    byPath.has(path) ? JSON.stringify(byPath.get(path)) : undefined,
  );
  if (!program) {
    const lines = diagnostics.filter((d) => d.severity === "error").map((d) => `${d.code} at ${d.path}: ${d.message}${d.hint ? ` (${d.hint})` : ""}`);
    throw new Error(`nudg: the file has errors:\n${lines.join("\n")}`);
  }
  return program;
}
