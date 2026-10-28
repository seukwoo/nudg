// The Vite plugin: .nudg.json files are compiled when they're imported, so a web app
// ships programs instead of the compiler. An import of a file with errors fails the build
// with the validator's messages; editing the file (or one it imports) reloads it in dev.
// Presets still work: the adapters build them with a small converter instead of the
// compiler. Rollup takes the same plugin.
//
//   // vite.config.ts
//   import { nudg } from "@nudg/core/vite";
//   export default defineConfig({ plugins: [react(), nudg()] });

import { readFileSync } from "node:fs";
import { compile } from "../core/compile.ts";
import { programToJson } from "../core/program-json.ts";
import { formatDiagnostic } from "../node/format.ts";

export interface NudgPluginOptions {
  /**
   * Keep the compiler in the bundle, for documents made at run time other than presets
   * (an editor, a file fetched from a server). Default false: about 28 kB gzipped less.
   */
  compiler?: boolean;
}

/** The slice of Vite's and Rollup's plugin context this plugin uses. */
interface Context {
  resolve(source: string, importer?: string, options?: { skipSelf?: boolean }): Promise<{ id: string } | null>;
  addWatchFile(id: string): void;
  error(message: string): never;
}

const PREFIX = "\0nudg:";
// The virtual id ends in .js so Vite's own JSON plugin leaves it alone.
const SUFFIX = ".program.js";

export function nudg(options: NudgPluginOptions = {}) {
  return {
    name: "nudg",
    enforce: "pre" as const,
    // Vite pre-bundles dependencies with esbuild, which wouldn't see the compiler swap below;
    // without it, development and the build would play documents differently.
    config: () => ({ optimizeDeps: { exclude: ["@nudg/core"] } }),

    async resolveId(this: Context, source: string, importer?: string) {
      if (/\.nudg\.json$/.test(source)) {
        const resolved = await this.resolve(source, importer, { skipSelf: true });
        return resolved ? PREFIX + resolved.id + SUFFIX : null;
      }
      // The adapters reach the compiler only through core/to-program; give them the version without it.
      if (!options.compiler && /(^|\/)to-program\.(js|ts)$/.test(source) && importer && isNudg(importer)) {
        const resolved = await this.resolve(source, importer, { skipSelf: true });
        return resolved ? resolved.id.replace(/to-program\.(js|ts)$/, "to-program-lean.$1") : null;
      }
      return null;
    },

    load(this: Context, id: string) {
      if (!id.startsWith(PREFIX)) return null;
      const path = id.slice(PREFIX.length, -SUFFIX.length);
      const read: string[] = [];
      const result = compile({ path, text: readFileSync(path, "utf8") }, (p) => {
        try {
          const text = readFileSync(p, "utf8");
          read.push(p);
          return text;
        } catch {
          return undefined;
        }
      });
      this.addWatchFile(path);
      for (const p of read) this.addWatchFile(p);
      if (!result.program) {
        const errors = result.diagnostics.filter((d) => d.severity === "error").map(formatDiagnostic);
        this.error(`${path} has errors:\n${errors.join("\n")}`);
      }
      return `export default ${JSON.stringify(programToJson(result.program))};\n`;
    },
  };
}

/** A module of this package, installed or (in this repository) from source. */
function isNudg(path: string): boolean {
  return /[\\/]@nudg[\\/]core[\\/]/.test(path) || path.startsWith(new URL("..", import.meta.url).pathname);
}
