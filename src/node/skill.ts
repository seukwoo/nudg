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

1. Read the file. If the change needs fields it doesn't show, or you are writing a new file, read the format with the \`nudg_guide\` tool first (or spec/guide.md in \`@nudg/core\`).
2. Edit the file. Feel words map to fields: "heavier" is a longer duration and less bounce; "snappier" the reverse.
3. Show the person, unasked: \`nudg_compare\` with \`file\` and \`before: "HEAD"\`, the \`events\` that play the change, and the running app's \`url\` if there is one. If the file measures sizes (\`"measure"\`), \`url\` (or \`html\`) measures them on the page; without a page, pass \`layout\` with the real ones from the host's CSS (\`{ "sheet.height": 150 }\`), or they are 0 and both versions can look the same. Don't call \`nudg_validate\` or \`nudg_critique\` first: it checks the edit too. A file with errors comes back with the validator's hints (fix and call again), and guideline warnings the change brings (too slow, late press feedback, bouncy fades) are listed under the headline; fix those first. The before/after opens in their browser once; later calls rewrite the same page, so ask them to reload. In a SwiftUI or Compose app, pass \`bundle\` instead (a \`.compare.json\` in the app's resources or assets) and have \`NudgCompare\` play it on the app's own view, in a preview or a debug screen. Pass the headline on in one sentence and say which side is which.
Something the app knows (a key, a network result, a timer it owns) reaches the file as a host event: list it under \`"host": { "events": [...] }\`, handle \`"host.close"\` in a state's \`"when"\`, and send it from the adapter: \`const { send } = useNudg(file)\` in React and React Native, then \`send("host.close")\` (\`player.send\` in the DOM player, \`nudg.send\` in SwiftUI and Compose). On the web and in React Native, a name the file can't act on warns once in the console.
4. For a new file, with nothing to compare against: \`nudg_validate\` until it is clean, then \`nudg_critique\` once.
5. If the headline says nobody would notice, offer an exaggerated version first (about 3x the change), then dial it back.
6. After wiring a file into the app, or when the person says it looks wrong there, \`nudg_observe\` the real page: it says whether the page played the file, or why not (unmounted mid-motion, a CSS transition fighting the spring, nothing bound).

When \`nudg_compare\` says a change has taken several rounds, ask the person once whether they'd share what made it hard with the nudg project. If yes, call \`nudg_share\` with their words as \`note\` and give them the link: it opens a prefilled GitHub issue with counts only, which they submit themselves. Never say it was sent.

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
