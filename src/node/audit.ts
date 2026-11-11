// nudg audit: where an app's motion lives outside nudg, and what in nudg would do it.
// Heuristic by design: it reads source text, never runs it. It reports and never fails;
// a line marked `nudg-audit-ignore` (or the line after such a comment) is left out.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export type AuditKind = "css-keyframes" | "css-transition" | "web-animation" | "motion-library" | "style-write" | "timer-glue" | "frame-loop" | "document-listener" | "feedback";

export interface AuditFinding {
  file: string;
  line: number;
  kind: AuditKind;
  /** The source line, trimmed. */
  text: string;
  /** What in nudg does this. */
  use: string;
  /** True when nudg has no clear equivalent: a gap to report rather than a line to rewrite. */
  gap?: boolean;
}

export interface Audit {
  /** Source files read (built and minified ones are skipped). */
  files: number;
  /** nudg files, nudg call sites, and calls of the app's own helpers around nudg: motion that is on nudg. */
  onNudg: number;
  findings: AuditFinding[];
  /** Custom property names declared in nudg files (host.custom, 1.3): what the host draws itself. */
  custom: string[];
  /** onNudg / (onNudg + findings), 0 to 100; 100 only when nothing is outside nudg. */
  coverage: number;
}

const SOURCE = /\.(css|scss|sass|less|tsx?|jsx?|mjs|cjs|vue|svelte|html)$/;
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "out", ".git", ".next", ".nuxt", ".svelte-kit", "coverage", "vendor", ".turbo", ".cache", "Pods", "DerivedData"]);
const SKIP_FILES = /\.(min|bundle|d)\.(js|css|ts)$|\.test\.|\.spec\.|__tests__/;

/** Every source file under `dir`, skipping dependencies, builds and tests. */
export function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name.startsWith(".") && name !== ".") continue;
      const path = join(d, name);
      let st;
      try {
        st = statSync(path);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(name) && !/^(test|tests|e2e|fixtures)$/.test(name)) walk(path);
      } else if ((SOURCE.test(name) || name.endsWith(".nudg.json")) && !SKIP_FILES.test(name) && st.size < 2_000_000) out.push(path);
    }
  };
  walk(dir);
  return out.sort();
}

export function auditDir(dir: string): Audit {
  const files = sourceFiles(dir).map((path) => ({ path: relative(dir, path) || path, text: readFileSync(path, "utf8") }));
  return audit(files);
}

const LIBRARIES: [RegExp, string, boolean?][] = [
  [/framer-motion|from ["']motion(\/react)?["']/, "a nudg file per interaction; useNudg / playDoc in place of motion components"],
  [/@react-spring|react-spring/, "a nudg file with spring motion; useNudg"],
  [/["']gsap["']|from ["']gsap\//, "a nudg file (timelines are per-property delays); playDoc"],
  [/["']animejs["']|["']anime\.js["']/, "a nudg file; playDoc"],
  [/["']popmotion["']|["']velocity-animate["']/, "a nudg file; playDoc"],
  [/react-transition-group/, "nudgTransition(file) on the library's transition slot, or useNudg with exit / onExit"],
  [/@formkit\/auto-animate|react-flip-toolkit/, "layout (FLIP) animation of reordering lists: nudg's animated-list recipe covers insert and remove, not reorder", true],
  [/react-native-reanimated|["']moti["']/, "useNudg from @nudg/core/native"],
  [/canvas-confetti|react-confetti|tsparticles|party-js/, "an emitter (1.4): \"emitters\" and \"emit\" in the file; pieces from data-nudg-piece templates"],
];

/** nudg uses: call sites that put motion on nudg. */
const NUDG_USE = /\b(useNudg|useNudgOnce|playDoc|playEach|nudgTransition|createPlayer|rememberNudg|NudgModel)\s*[(<]|\.nudg\(|data-nudg=/g;

/** CSS properties a nudg file can move (x, y, rotation, scale, opacity, width, height, background color; shadow and blur from 1.3). */
const NUDG_CSS = new Set(["transform", "translate", "rotate", "scale", "opacity", "width", "height", "background", "background-color", "offset", "easing", "animation-timing-function", "box-shadow", "filter"]);

/** The body of the @keyframes block that starts at `start`, by brace counting. */
function blockAt(text: string, start: number): string {
  const open = text.indexOf("{", start);
  if (open < 0) return "";
  let depth = 0;
  for (let i = open; i < text.length && i < open + 4000; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(open, i + 1);
  }
  return text.slice(open, open + 4000);
}

function keyframesUse(name: string, body: string): { use: string; gap?: boolean } {
  const n = name.toLowerCase();
  const props = [...new Set([...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]))].filter((p) => !NUDG_CSS.has(p));
  if (props.length) return { use: `animates ${props.join(", ")}, which no nudg property moves yet; a custom property (target.custom.<name>, drawn through var(--nudg-<name>)) keeps its timing in nudg`, gap: true };
  if (/box-shadow/.test(body) && /\b0\s+0\s+0\s+[1-9][\d.]*px/.test(body))
    return { use: "a ring that spreads: a separate ring element whose scale grows as it fades (nudg shadows have no spread)" };
  if (/box-shadow|filter\s*:\s*blur/.test(body)) return { use: "shadowX / shadowY / shadowBlur / shadowColor or blur (1.3), in a state's set and enter like any property" };
  if (/shake|wobble|jiggle|nope/.test(n)) return { use: "presets.shake(), played with release: \"settle\"" };
  if (/spin|rotat|load|pulse|blink|breath|shimmer|skeleton|bounce-?loop|float|wave|typing|dots/.test(n)) return { use: "a loop in a state (the spinner, skeleton or typing-indicator recipe)" };
  if (/confetti|particle|burst|firework|sparkle/.test(n)) return { use: "an emitter (1.4): \"emitters\" and \"emit\" in the file, drawn from data-nudg-piece templates" };
  if (/out|leave|exit|hide|close|dismiss/.test(n)) return { use: "an exit state with `exit` / onExit (unmount after the way out), or nudgTransition" };
  return { use: "useNudgOnce(presets.pop() / drop() / appear()), or entry keyframes in a file for this exact shape" };
}

/** Names a file that imports nudg exports: the app's own helpers around nudg (a sheet hook, a shake). */
function wrappers(files: { path: string; text: string }[]): Set<string> {
  const names = new Set<string>();
  for (const { text } of files) {
    if (!/from ["']@nudg\/core/.test(text)) continue;
    for (const m of text.matchAll(/export\s+(?:async\s+)?(?:function|const|let)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  }
  return names;
}

export function audit(files: { path: string; text: string }[]): Audit {
  const findings: AuditFinding[] = [];
  const custom: string[] = [];
  let onNudg = 0;
  // Calls of the app's own helpers around nudg count as nudg uses, wherever they are.
  const helpers = wrappers(files);
  const helperCall = helpers.size ? new RegExp(`(?<![\\w$.])(${[...helpers].join("|")})\\s*\\(`, "g") : undefined;
  for (const { path, text } of files) {
    if (path.endsWith(".nudg.json")) {
      onNudg++;
      try {
        for (const name of (JSON.parse(text)?.host?.custom ?? []) as unknown[]) if (typeof name === "string" && !custom.includes(name)) custom.push(name);
      } catch {}
      continue;
    }
    const lines = text.split("\n");
    // Built or minified output is someone else's source.
    if (lines.some((l) => l.length > 3000)) continue;
    const offsets: number[] = [];
    for (let i = 0, at = 0; i < lines.length; at += lines[i].length + 1, i++) offsets.push(at);
    const usesNudg = /@nudg\/core|\.nudg\.json/.test(text);
    onNudg += (text.match(NUDG_USE) ?? []).length;
    if (helperCall) onNudg += [...text.matchAll(helperCall)].filter((m) => !/(function|const|let)\s+$/.test(text.slice(Math.max(0, m.index! - 20), m.index))).length;
    const add = (i: number, kind: AuditKind, use: string, gap?: boolean) => {
      if (/nudg-audit-ignore/.test(lines[i]) || (i > 0 && /nudg-audit-ignore/.test(lines[i - 1]))) return;
      const f: AuditFinding = { file: path, line: i + 1, kind, text: lines[i].trim().slice(0, 160), use };
      if (gap) f.gap = true;
      findings.push(f);
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const kf = /@(?:-webkit-)?keyframes\s+([\w-]+)/.exec(line);
      if (kf) {
        const k = keyframesUse(kf[1], blockAt(text, offsets[i] + kf.index));
        add(i, "css-keyframes", k.use, k.gap);
      }
      // A transition of something that moves; colors and borders alone are left to CSS.
      const tr = /(?:^|[\s;{"'`])transition(?:-property)?\s*:\s*([^\s;}"'`][^;}"'`]*)/.exec(line) ?? /\btransition\s*:\s*["'`]([^"'`]+)/.exec(line);
      if (tr && /\b(all|transform|opacity|translate|scale|rotate|top|left|right|bottom|width|height|max-height)\b/.test(tr[1]) && !/\bnone\b/.test(tr[1]))
        add(i, "css-transition", "a nudg file on the element (a preset, or playEach for every match); on an element nudg moves, the adapter already turns this off");
      if (/\.animate\(\s*[[{]/.test(line)) add(i, "web-animation", "playDoc(file, element) with entry keyframes or a transition");
      for (const [re, use, gap] of LIBRARIES) if (re.test(line) && /\b(import|require)\b/.test(line)) add(i, "motion-library", use, gap);
      if (/\.style\.(transform|opacity|translate|scale|rotate)\s*=(?!=)/.test(line) && !/=\s*["'`]{2}/.test(line))
        add(i, "style-write", "let a player write it: a file's values for the element, or an input the file maps (input(\"host.progress\", v))");
      const near = (before: number, after: number) => lines.slice(Math.max(0, i - before), i + after + 1).join("\n");
      // A loop that samples app values into a player (`input(...)`) is how nudg is meant to be fed.
      if (/requestAnimationFrame\s*\(/.test(line) && !/\.input\(\s*["'`]/.test(near(8, 2))) add(i, "frame-loop", "if it moves something: a follow or map from an input, or a loop in a state (physics and canvas scenes are outside nudg); if it doesn't, mark it nudg-audit-ignore");
      // Only timers that do motion's work: sending to a player, letting it go, unmounting, styling.
      if (usesNudg && /\bsetTimeout\s*\(/.test(line) && /\.send\(|\.destroy\(|\.remove\(|[Mm]ounted|unmount|\.style\b|letGo|[Cc]lose\(/.test(near(0, 2)))
        add(i, "timer-glue", "onSettle / onExit, release: \"settle\", after:<time> in the file, or delay.input; not a timer");
      // Sound and haptics played by hand, which a cue would time with the motion (1.3).
      if (/navigator\.vibrate\s*\(|new Audio\s*\(|\.playHaptics\s*\(|\b(impactAsync|notificationAsync|selectionAsync)\s*\(|performHapticFeedback\s*\(|UI(Impact|Selection|Notification)FeedbackGenerator\b/.test(line) || (/\b(import|require)\b/.test(line) && /["'](howler|expo-haptics|react-native-haptic-feedback|use-sound)["']/.test(line)))
        add(i, "feedback", "a cue in the file (\"cue\": { \"haptic\": \"success\", \"sound\": \"pop\" }) with the adapter's sound map; nudg fires it on the same frame as the motion");
      if (usesNudg && /addEventListener\(\s*["']pointerdown["']/.test(line) && /capture/.test(lines.slice(i, i + 20).join("\n")))
        add(i, "document-listener", "playEach(file, selector): binds each element on the touch that lands");
    }
  }
  const total = onNudg + findings.length;
  return { files: files.length, onNudg, findings, custom, coverage: findings.length === 0 ? 100 : Math.min(99, Math.round((onNudg / total) * 100)) };
}

const KIND_LABEL: Record<AuditKind, string> = {
  "css-keyframes": "CSS keyframes",
  "css-transition": "CSS transition",
  "web-animation": "Web Animations",
  "motion-library": "motion library",
  "style-write": "style written by hand",
  "timer-glue": "timer around a player",
  "frame-loop": "frame loop",
  "document-listener": "document listener",
  feedback: "sound or haptic played by hand",
};

export function formatAudit(a: Audit): string {
  const outside = a.findings.length;
  const gaps = a.findings.filter((f) => f.gap).length;
  const lines = [`Motion on nudg: ${a.coverage}% (${a.onNudg} on nudg, ${outside} outside, in ${a.files} files)`];
  if (a.custom.length) lines.push(`Custom properties the app draws itself: ${a.custom.join(", ")}. If nudg should draw one of them, report it.`);
  if (outside === 0) {
    lines.push("Every motion found is on nudg: one format, checked, comparable, with reduced motion everywhere.");
    return lines.join("\n");
  }
  const counts = new Map<AuditKind, number>();
  for (const f of a.findings) counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1);
  lines.push([...counts].map(([k, n]) => `${n} ${KIND_LABEL[k]}`).join(", "));
  lines.push(
    gaps === 0
      ? `nudg covers all ${outside}: each line below says what to use.`
      : `nudg covers ${outside - gaps} of ${outside}; ${gaps} need something nudg lacks (marked "gap"): report them to the nudg project rather than working around them.`,
  );
  let file = "";
  for (const f of a.findings) {
    if (f.file !== file) {
      file = f.file;
      lines.push("", file);
    }
    lines.push(`  ${f.line}: ${KIND_LABEL[f.kind]}${f.gap ? " (gap)" : ""}: ${f.text}`, `      → ${f.use}`);
  }
  lines.push("", "Mark a deliberate one with a `nudg-audit-ignore` comment on or above its line.");
  return lines.join("\n");
}
