// A one-time line asking people who find nudg useful for a GitHub star.
// Terminal only and once per machine; never for MCP, --json, CI, piped output, or with NUDG_NO_STAR set.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const STAR_LINE =
  "If nudg helps you, a ⭐ on GitHub helps others find it: https://github.com/seukwoo/nudg (shown once; NUDG_NO_STAR=1 hides it)";

export function starMarkerPath(env: Record<string, string | undefined> = process.env): string {
  return env.NUDG_STAR_MARKER ?? join(homedir(), ".nudg", "star-shown");
}

export type StarCheck = {
  code: number;
  command: string;
  json: boolean;
  isTTY: boolean;
  env: Record<string, string | undefined>;
  seen: boolean;
};

/** Whether to show the line: a successful command a person ran in a terminal, the first time only. */
export function shouldShowStar(c: StarCheck): boolean {
  if (c.code !== 0 || c.json || !c.isTTY || c.seen) return false;
  if (c.command === "mcp" || c.command === "help") return false;
  if (c.env.CI && !/^(0|false)$/i.test(c.env.CI)) return false;
  if (c.env.NUDG_NO_STAR && !/^(0|false|no)$/i.test(c.env.NUDG_NO_STAR)) return false;
  return true;
}

/** Shows the line once and remembers it. Never throws: a read-only home just means no line. */
export function showStarOnce(code: number, command: string, json: boolean): void {
  try {
    const marker = starMarkerPath();
    const check = { code, command, json, isTTY: Boolean(process.stderr.isTTY), env: process.env, seen: existsSync(marker) };
    if (!shouldShowStar(check)) return;
    mkdirSync(dirname(marker), { recursive: true });
    writeFileSync(marker, new Date().toISOString() + "\n");
    process.stderr.write(`\n${STAR_LINE}\n`);
  } catch {
    // Nothing to do: the line is optional.
  }
}
