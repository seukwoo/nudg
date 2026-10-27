// The public surface nudg 1.0 freezes, as text under api/: the TypeScript declarations of
// every package entry point, the CLI's help, the MCP tools and their parameters, and the
// public declarations of the Swift package and the Kotlin modules. test/surface.test.ts
// fails when the source no longer matches; a deliberate change regenerates them with
// `npm run api` and shows up in review as a diff.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function files(dir: string, ext: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path, ext) : name.endsWith(ext) ? [path] : [];
  });
}

/** Top-level declarations of a .d.ts file, by exported name, without comments. */
function declarations(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const lines = text.replace(/\/\*\*[\s\S]*?\*\//g, "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^export (?:declare )?(?:abstract )?(?:function|const|let|class|interface|type|enum) ([A-Za-z_$][\w$]*)/.exec(lines[i]);
    if (!m) continue;
    const body = [lines[i]];
    // A declaration runs until the next line that starts at column 0 and isn't its closing brace.
    while (i + 1 < lines.length && (/^\s/.test(lines[i + 1]) || /^[})\]]/.test(lines[i + 1]))) body.push(lines[++i]);
    const decl = body.map((l) => l.replace(/\/\/.*$/, "").trim()).filter(Boolean).join(" ");
    out.set(m[1], [...(out.get(m[1]) ?? []), decl]);
  }
  return out;
}

/** What a .d.ts module exports, followed through re-exports: exported name → declarations. */
function exportsOf(file: string, seen = new Set<string>()): Map<string, string[]> {
  if (seen.has(file)) return new Map();
  seen.add(file);
  const text = readFileSync(file, "utf8");
  const out = declarations(text);
  const target = (spec: string) => resolve(dirname(file), spec.replace(/\.(ts|js)$/, ".d.ts"));
  for (const m of text.matchAll(/^export (?:type )?\{([^}]*)\} from "([^"]+)";/gm)) {
    const from = exportsOf(target(m[2]), new Set(seen));
    for (const part of m[1].split(",").map((s) => s.trim()).filter(Boolean)) {
      const [name, alias] = part.replace(/^type /, "").split(/\s+as\s+/);
      out.set(alias ?? name, from.get(name) ?? [`(re-exported ${name})`]);
    }
  }
  // `export { a, type B };` re-exports names the file imported.
  for (const m of text.matchAll(/^export \{([^}]*)\};/gm)) {
    for (const part of m[1].split(",").map((s) => s.trim().replace(/^type /, "")).filter(Boolean)) {
      const imported = [...text.matchAll(/^import (?:type )?\{([^}]*)\} from "([^"]+)";/gm)].find((i) => i[1].split(",").some((s) => s.trim().replace(/^type /, "") === part));
      if (imported) out.set(part, exportsOf(target(imported[2]), new Set(seen)).get(part) ?? [`(re-exported ${part})`]);
    }
  }
  for (const m of text.matchAll(/^export (?:type )?\* from "([^"]+)";/gm)) {
    for (const [name, decls] of exportsOf(target(m[1]), new Set(seen))) if (!out.has(name)) out.set(name, decls);
  }
  return out;
}

function typescriptSurface(): string {
  const out = mkdtempSync(join(tmpdir(), "nudg-api-"));
  try {
    execFileSync(process.execPath, [join(ROOT, "node_modules/typescript/bin/tsc"), "-p", join(ROOT, "tsconfig.build.json"), "--outDir", out, "--emitDeclarationOnly"], { stdio: "pipe" });
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    const sections: string[] = [];
    for (const [entry, value] of Object.entries(pkg.exports as Record<string, { types?: string } | string>)) {
      if (typeof value === "string" || !value.types) continue;
      const file = join(out, relative("dist", value.types.replace(/^\.\//, "")));
      const names = [...exportsOf(file)].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      sections.push(`## @nudg/core${entry === "." ? "" : entry.slice(1)}\n\n${names.flatMap(([, decls]) => decls).join("\n")}\n`);
    }
    return sections.join("\n");
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

function cliSurface(): string {
  return execFileSync(process.execPath, [join(ROOT, "src/cli.ts"), "--help"], { encoding: "utf8" });
}

function mcpSurface(): string {
  const requests = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "api", version: "0" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
  ];
  const run = spawnSync(process.execPath, [join(ROOT, "src/cli.ts"), "mcp"], { input: requests.map((r) => JSON.stringify(r)).join("\n") + "\n", encoding: "utf8", env: { ...process.env, NUDG_LOG: "off" } });
  const list = run.stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line)).find((m) => m.id === 2);
  return (list.result.tools as { name: string; inputSchema: { properties?: Record<string, { type?: string }>; required?: string[] } }[])
    .map((tool) => {
      const required = new Set(tool.inputSchema.required ?? []);
      const params = Object.entries(tool.inputSchema.properties ?? {}).map(([name, p]) => `${name}${required.has(name) ? "" : "?"}: ${p.type ?? "any"}`);
      return `${tool.name}(${params.join(", ")})`;
    })
    .join("\n") + "\n";
}

/** `public` declarations, one per line, without bodies. */
function swiftSurface(): string {
  const lines: string[] = [];
  for (const file of ["Nudg", "NudgSwiftUI"].flatMap((target) => files(join(ROOT, "swift/Sources", target), ".swift")).sort()) {
    lines.push(`// ${relative(join(ROOT, "swift/Sources"), file)}`);
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const t = line.trim();
      if (/^(\/\/|\*|\/\*)/.test(t) || !/^(@\w+(\(.*?\))?\s+)*public\b/.test(t)) continue;
      lines.push(t.replace(/\s*\{.*$/, "").replace(/\s*=.*$/, ""));
    }
  }
  return lines.join("\n") + "\n";
}

/** Top-level and member declarations that aren't private or internal (Kotlin's default is public). */
function kotlinSurface(): string {
  const lines: string[] = [];
  const decl = /^(?:(?:public|data|sealed|enum|inline|value|abstract|open|override|operator|const|lateinit|private|internal|protected|companion)\s+)*(fun|class|interface|object|val|var|typealias)\b/;
  for (const file of ["nudg", "compose"].flatMap((module) => files(join(ROOT, "kotlin", module, "src/main/kotlin"), ".kt")).sort()) {
    lines.push(`// ${relative(join(ROOT, "kotlin"), file)}`);
    // What each open brace opened: a visible type's body holds members; a hidden type's or any other body doesn't.
    const stack: ("type" | "hidden" | "other")[] = [];
    // A type whose header spans lines (`class X(` … `) {`) opens its body on a later line.
    let pending: "type" | "hidden" | undefined;
    let comment = false;
    for (const raw of readFileSync(file, "utf8").split("\n")) {
      const line = raw.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/\/\/.*$/, "");
      if (comment || line.trim().startsWith("/*")) {
        comment = !line.includes("*/");
        continue;
      }
      const t = line.trim().replace(/^@Composable\s+/, "");
      const kind = decl.exec(t)?.[1];
      // Only the modifiers before the keyword decide: `class X internal constructor(...)` is a public class.
      const visible = kind && !/\b(private|internal|protected)\b/.test(t.slice(0, t.search(new RegExp(`\\b${kind}\\b`))));
      if (visible && stack.every((s) => s === "type")) {
        lines.push(`${"    ".repeat(stack.length)}${t.replace(/\s*\{.*$/, "").replace(/\s+=\s+[^=].*$/, "")}`);
      }
      const isType = kind && ["class", "interface", "object"].includes(kind) && !line.includes("fun ");
      if (isType && !line.includes("{") && line.trimEnd().endsWith("(")) pending = visible ? "type" : "hidden";
      for (const ch of line) {
        if (ch === "{") {
          stack.push(isType ? (visible ? "type" : "hidden") : pending ?? "other");
          pending = undefined;
        } else if (ch === "}") stack.pop();
      }
    }
  }
  return lines.join("\n") + "\n";
}

export function apiSurface(): Map<string, string> {
  return new Map([
    ["typescript.txt", typescriptSurface()],
    ["cli.txt", cliSurface()],
    ["mcp.txt", mcpSurface()],
    ["swift.txt", swiftSurface()],
    ["kotlin.txt", kotlinSurface()],
  ]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const [name, text] of apiSurface()) writeFileSync(join(ROOT, "api", name), text);
  console.log("wrote api/");
}
