// to-program.ts without the compiler, for web apps whose .nudg.json files are compiled at
// build time (`nudg()` in the Vite config puts this module in its place). Programs and
// compiled programs pass as before; presets are built by lower.ts; anything else needs
// the compiler, and the error says how to get it.

import { lowerSimple } from "./lower.ts";
import { programFromJson } from "./program-json.ts";
import type { Program } from "./types.ts";

export function toProgram(source: Program | object, _files: Record<string, unknown> = {}): Program {
  if ("machine" in source && (source as Program).properties instanceof Map) return source as Program;
  if ("nudgProgram" in source) return programFromJson(source);
  const program = lowerSimple(source);
  if (program) return program;
  throw new Error(
    "nudg: this document isn't compiled. With the Vite plugin, .nudg.json files are compiled when they're imported and presets are built in the browser; " +
      "a document made some other way needs the compiler in the bundle: nudg({ compiler: true }) in vite.config.",
  );
}
