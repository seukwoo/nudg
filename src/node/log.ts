// A local record of the judge loop: one JSON line per compare, observe and validate,
// so anyone can see how many rounds a judged change took, without sending anything
// anywhere. On by default, in ~/.nudg/log.jsonl; NUDG_LOG=off turns it off, and
// NUDG_LOG=<path> writes somewhere else.

import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export interface LogEntry {
  /** Entry format version. */
  v: 1;
  /** ISO time. */
  t: string;
  via: "cli" | "mcp";
  /** One per process: an MCP session, or one CLI run. */
  session: string;
  tool: "compare" | "observe" | "validate";
  cwd: string;
  /** The files involved, as given (relative to cwd when they were). */
  files: string[];
  /** For compare: the git revision used as the before. */
  before?: string;
  url?: string;
  /** compare: identical / imperceptible / subtle / clear. observe: played / differs / never-shown / nothing-moved / unmeasured. validate: ok / errors. */
  verdict?: string;
  headline?: string;
  opened?: boolean;
  error?: string;
}

const SESSION = randomUUID().slice(0, 8);
/** Compares of the same file further apart than this are separate changes. */
const CHAIN_GAP_MS = 15 * 60 * 1000;

/** Where the log goes, or undefined when it is off. */
export function logPath(): string | undefined {
  const env = process.env.NUDG_LOG;
  if (env && /^(off|false|0|no)$/i.test(env)) return undefined;
  if (env) return env;
  return join(homedir(), ".nudg", "log.jsonl");
}

/** Appends one entry. Never throws: a log that can't be written must not break a tool. */
export function record(entry: Omit<LogEntry, "v" | "t" | "session" | "cwd">): void {
  const path = logPath();
  if (!path) return;
  try {
    mkdirSync(dirname(path), { recursive: true });
    const full: LogEntry = { v: 1, t: new Date().toISOString(), session: SESSION, cwd: process.cwd(), ...entry };
    if (full.headline && full.headline.length > 300) full.headline = full.headline.slice(0, 300) + "…";
    appendFileSync(path, JSON.stringify(full) + "\n");
  } catch {
    // A read-only home, a full disk: carry on without a record.
  }
}

export function readLog(path = logPath()): LogEntry[] {
  if (!path || !existsSync(path)) return [];
  const out: LogEntry[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // A torn line from a crash; skip it.
    }
  }
  return out;
}

export function clearLog(path = logPath()): void {
  if (path) rmSync(path, { force: true });
}

export interface LogSummary {
  entries: number;
  sessions: number;
  from?: string;
  to?: string;
  compare: { calls: number; verdicts: Record<string, number>; opened: number; errors: number };
  /** How many compare rounds each change took (the same file compared again within 15 min): the proxy for "turns per judged change". */
  rounds: { median: number; max: number; changes: number; histogram: Record<string, number> };
  observe: { calls: number; verdicts: Record<string, number>; errors: number };
  validate: { calls: number; failed: number };
  /** Rounds that showed the person nothing they could see: identical or imperceptible. */
  wasted: number;
}

export function summarize(entries: LogEntry[]): LogSummary {
  const count = (list: LogEntry[]) => list.reduce<Record<string, number>>((m, e) => ((m[e.verdict ?? "error"] = (m[e.verdict ?? "error"] ?? 0) + 1), m), {});
  const compares = entries.filter((e) => e.tool === "compare");
  const observes = entries.filter((e) => e.tool === "observe");
  const validates = entries.filter((e) => e.tool === "validate");
  // A judged change: the same "after" file in the same project, compared again within
  // CHAIN_GAP of the last time. CLI runs are separate processes, so sessions can't tell.
  const open = new Map<string, { last: number; n: number }>();
  const lengths: number[] = [];
  for (const e of compares) {
    if (e.error) continue;
    const key = `${e.cwd}|${e.files.at(-1) ?? ""}`;
    const t = Date.parse(e.t);
    const chain = open.get(key);
    if (chain && t - chain.last <= CHAIN_GAP_MS) {
      chain.n++;
      chain.last = t;
    } else {
      if (chain) lengths.push(chain.n);
      open.set(key, { last: t, n: 1 });
    }
  }
  for (const chain of open.values()) lengths.push(chain.n);
  lengths.sort((a, b) => a - b);
  const histogram: Record<string, number> = {};
  for (const n of lengths) {
    const k = n >= 5 ? "5+" : String(n);
    histogram[k] = (histogram[k] ?? 0) + 1;
  }
  return {
    entries: entries.length,
    sessions: new Set(entries.map((e) => e.session)).size,
    from: entries[0]?.t,
    to: entries.at(-1)?.t,
    compare: { calls: compares.length, verdicts: count(compares), opened: compares.filter((e) => e.opened).length, errors: compares.filter((e) => e.error).length },
    rounds: { median: lengths.length ? lengths[Math.floor((lengths.length - 1) / 2)] : 0, max: lengths.at(-1) ?? 0, changes: lengths.length, histogram },
    observe: { calls: observes.length, verdicts: count(observes), errors: observes.filter((e) => e.error).length },
    validate: { calls: validates.length, failed: validates.filter((e) => e.verdict === "errors").length },
    wasted: compares.filter((e) => e.verdict === "identical" || e.verdict === "imperceptible").length,
  };
}

export function formatSummary(s: LogSummary, path: string | undefined): string {
  if (!path) return "The log is off (NUDG_LOG=off).";
  if (s.entries === 0) return `Nothing logged yet in ${path}. Every compare, observe and validate adds a line.`;
  const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "-");
  const verdicts = (m: Record<string, number>) => Object.entries(m).map(([k, v]) => `${k} ${v}`).join(", ") || "none";
  return [
    `${s.entries} entries, ${s.sessions} sessions, ${s.from?.slice(0, 10)} to ${s.to?.slice(0, 10)} (${path})`,
    "",
    `Judged changes: ${s.rounds.changes}. Rounds per change: median ${s.rounds.median}, max ${s.rounds.max} (${Object.entries(s.rounds.histogram).map(([k, v]) => `${k}: ${v}`).join(", ")}).`,
    `Compare: ${s.compare.calls} calls (${verdicts(s.compare.verdicts)}); pages opened ${s.compare.opened}; nothing to see ${s.wasted} (${pct(s.wasted, s.compare.calls)}).`,
    `Observe: ${s.observe.calls} calls (${verdicts(s.observe.verdicts)}).`,
    `Validate: ${s.validate.calls} calls, ${s.validate.failed} with errors.`,
    "",
    "The log stays on this machine. Please share it: `nudg log --share` shows the counts it would send (nothing about your app) and opens a GitHub issue for you to submit. It's how nudg learns whether a change takes one round or five.",
  ].join("\n");
}

/**
 * What `nudg log --share` sends: counts only. No paths, file names, URLs, headlines or
 * property names, so nothing about the person's app leaves with it.
 */
export function shareableSummary(s: LogSummary, version: string): Record<string, unknown> {
  return {
    nudg: version,
    node: process.versions.node,
    platform: process.platform,
    days: s.from && s.to ? Math.max(1, Math.round((Date.parse(s.to) - Date.parse(s.from)) / 86_400_000) + 1) : 0,
    sessions: s.sessions,
    changes: s.rounds.changes,
    roundsPerChange: { median: s.rounds.median, max: s.rounds.max, histogram: s.rounds.histogram },
    compare: { calls: s.compare.calls, verdicts: s.compare.verdicts, pagesOpened: s.compare.opened, errors: s.compare.errors, nothingToSee: s.wasted },
    observe: { calls: s.observe.calls, verdicts: s.observe.verdicts, errors: s.observe.errors },
    validate: s.validate,
  };
}

/** A prefilled GitHub issue for the shared summary; the person reads it and submits. */
export function shareUrl(summary: Record<string, unknown>): string {
  const body = [
    "Usage summary from `nudg log --share`. Counts only: no file names, paths, URLs or code.",
    "",
    "```json",
    JSON.stringify(summary, null, 2),
    "```",
    "",
    "Anything that took many rounds, or a verdict that was wrong? (optional)",
    "",
  ].join("\n");
  const params = new URLSearchParams({ title: `Usage log: ${summary.changes} changes, median ${(summary.roundsPerChange as { median: number }).median} rounds`, labels: "usage-log", body });
  return `https://github.com/seukwoo/nudg/issues/new?${params.toString()}`;
}

/** How often the CLI may suggest sharing, at most. */
const TIP_EVERY_MS = 7 * 86_400_000;

/**
 * A one-line suggestion to share, at most once a week and only once there is something
 * worth sharing (three judged changes). Never shown with logging off.
 */
export function shareTip(): string | undefined {
  const path = logPath();
  if (!path) return undefined;
  const marker = join(dirname(path), "share-tip");
  try {
    if (existsSync(marker) && Date.now() - Number(readFileSync(marker, "utf8")) < TIP_EVERY_MS) return undefined;
    const s = summarize(readLog(path));
    if (s.rounds.changes < 3) return undefined;
    writeFileSync(marker, String(Date.now()));
    return `tip: you've judged ${s.rounds.changes} motion changes with nudg (median ${s.rounds.median} rounds each). \`nudg log --share\` sends the project those counts, nothing about your app.`;
  } catch {
    return undefined;
  }
}
