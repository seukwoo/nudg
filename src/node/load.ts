import { readFileSync } from "node:fs";
import { compile, type CompileResult } from "../core/compile.ts";

/** Compiles a nudg file from disk, resolving imports relative to it. */
export function compilePath(path: string): CompileResult {
  return compile({ path, text: readFileSync(path, "utf8") }, readOptional);
}

function readOptional(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}
