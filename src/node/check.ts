// `nudg check`: one call over a project, and two lists by who acts. What the AI can fix
// without asking (validation errors, guideline warnings with one fix, glue nudg replaces)
// goes back to the agent as data; it fixes them and checks again. What needs taste or a
// decision goes to the person, one line each. The headline is the only text an agent
// passes on, and when nothing needs the person it may say nothing at all.

import { relative } from "node:path";
import { critique } from "../core/critique.ts";
import { auditDir, sourceFiles } from "./audit.ts";
import { compilePath } from "./load.ts";

export interface CheckItem {
  /** A file that doesn't validate, a guideline the motion misses, or motion outside nudg. */
  kind: "error" | "guideline" | "outside";
  file: string;
  /** A validation code, a critique code, or the audit's finding kind. */
  code: string;
  /** JSON pointer in a nudg file, or a line in source. */
  where: string;
  message: string;
  /** What to do. */
  fix: string;
}

export interface Check {
  /** nudg files checked. */
  files: number;
  /** Transitions those files play, each checked against the guidelines. */
  transitions: number;
  /** The audit's share of the app's motion on nudg, 0 to 100. */
  coverage: number;
  /** What the AI fixes without asking, then checks again. */
  forAi: CheckItem[];
  /** What only the person can decide, one line each. */
  forPerson: CheckItem[];
  /** Findings the files keep (`"keep"`), counted and not raised. */
  kept: number;
  headline: string;
}

/**
 * Who acts on each critique code. Fixed in the spec, so the same finding always goes the same
 * way and an agent can't route around the person: a rule with one right answer is the AI's;
 * one that can be a choice (a slow, deliberate exit) is the person's.
 */
export const CHECK_ROUTES: Record<string, "ai" | "person"> = {
  "late-feedback": "ai",
  "invisible-change": "ai",
  "bouncy-fade": "ai",
  "no-escape": "ai",
  "slow-transition": "person",
  "slow-exit": "person",
  "short-timeout": "person",
};

export function checkDir(dir: string): Check {
  const forAi: CheckItem[] = [];
  const forPerson: CheckItem[] = [];
  let transitions = 0;
  let kept = 0;
  const files = sourceFiles(dir).filter((f) => f.endsWith(".nudg.json"));
  for (const path of files) {
    const file = relative(dir, path) || path;
    const result = compilePath(path);
    for (const d of result.diagnostics) {
      if (d.severity !== "error") continue;
      forAi.push({ kind: "error", file, code: d.code, where: d.path, message: d.message, fix: d.hint ?? "" });
    }
    if (!result.program) continue;
    const c = critique(result.program);
    transitions += c.transitions.length;
    kept += c.kept.length;
    for (const f of c.findings) {
      // A suggestion that can be a choice still goes to the person; nothing is dropped.
      const to = CHECK_ROUTES[f.code] ?? "person";
      (to === "ai" ? forAi : forPerson).push({ kind: "guideline", file, code: f.code, where: f.path, message: f.message, fix: f.hint });
    }
  }
  const audit = auditDir(dir);
  for (const f of audit.findings) {
    const item: CheckItem = { kind: "outside", file: f.file, code: f.kind, where: `line ${f.line}`, message: f.text, fix: f.use };
    // Glue nudg replaces is the AI's to move; a gap is nudg's to fill, and the person should know.
    (f.gap ? forPerson : forAi).push(item);
  }
  const check: Check = { files: files.length, transitions, coverage: audit.coverage, forAi, forPerson, kept, headline: "" };
  check.headline = headline(check);
  return check;
}

function headline(c: Check): string {
  const scope = `${c.files} nudg file${c.files === 1 ? "" : "s"}, ${c.transitions} transition${c.transitions === 1 ? "" : "s"}, ${c.coverage}% of the app's motion on nudg`;
  if (c.forPerson.length) {
    const first = c.forPerson[0];
    const more = c.forPerson.length > 1 ? ` (and ${c.forPerson.length - 1} more)` : "";
    return `${scope}. ${c.forPerson.length} need${c.forPerson.length === 1 ? "s" : ""} you: ${first.file}: ${first.message}${more}`;
  }
  if (c.forAi.length) return `${scope}. ${c.forAi.length} for the AI to fix before anyone looks.`;
  return `${scope}. Nothing needs you.`;
}

export function formatCheck(c: Check): string {
  const lines = [c.headline];
  if (c.kept) lines.push(`(${c.kept} kept on purpose, not raised.)`);
  if (c.forPerson.length) {
    lines.push("", "For the person: ask, one line each.");
    for (const i of c.forPerson) lines.push(`  ${i.file} ${i.where}: ${i.message}`, `      → ${i.fix}`);
  }
  if (c.forAi.length) {
    lines.push("", "For the AI: fix these without asking, then run check again.");
    for (const i of c.forAi) lines.push(`  ${i.file} ${i.where} [${i.code}]: ${i.message}`, `      → ${i.fix}`);
  }
  if (c.forPerson.length) lines.push("", 'When the person keeps a choice, add its code to the file\'s "keep" (with a "note" saying why), so it isn\'t raised again.');
  return lines.join("\n");
}
