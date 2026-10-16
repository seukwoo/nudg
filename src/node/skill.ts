// A Claude Code skill that teaches an agent the nudg loop, installed with `nudg skill`.

import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const SKILL = `---
name: nudg
description: Use when building or changing UI interactions and motion (press, toggle, sheet, toast, drag, springs, "make it bouncier / heavier / snappier") in a project that uses nudg (*.nudg.json files or @nudg/core), or when the person asks to see or judge a motion change.
---

# nudg: say, see, judge

nudg files (\`*.nudg.json\`) describe an interaction: states, events, and spring or tween motion. You write them; the person judges motion by looking, not by reading JSON.

1. Before the first edit, read the format with the \`nudg_guide\` tool (or \`npx @nudg/core\` docs in spec/guide.md).
2. Edit the file. Map feel words to fields with the guide ("heavier" is a longer duration and less bounce; "snappier" the reverse).
3. \`nudg_validate\` until it is clean. Every error has a hint that says how to fix it.
4. Show the person, unasked: \`nudg_compare\` with \`file\` and \`before: "HEAD"\`, and the running app's \`url\` if there is one. The before/after opens in their browser once; later calls rewrite the same page, so ask them to reload. Pass the headline on in one sentence and say which side is which.
5. If the headline says nobody would notice, offer an exaggerated version first (about 3x the change), then dial it back.
6. After wiring a file into the app, or when the person says it looks wrong there, \`nudg_observe\` the real page: it says whether the page played the file, or why not (unmounted mid-motion, a CSS transition fighting the spring, nothing bound).

Without the MCP server, the CLI does the same: \`npx @nudg/core validate|compare|observe ...\`. Add the server with \`claude mcp add nudg -- npx -y @nudg/core mcp\`.
`;

/** Writes the skill for this project (./.claude/skills) or for every project (~/.claude/skills). Returns the path. */
export function installSkill(scope: "project" | "user"): string {
  const dir = join(scope === "user" ? homedir() : process.cwd(), ".claude", "skills", "nudg");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "SKILL.md");
  writeFileSync(path, SKILL);
  return path;
}
