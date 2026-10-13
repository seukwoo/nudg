#!/usr/bin/env node
// nudg CLI. Every command takes --json so an agent can read the result directly.

import { existsSync, writeFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { plot } from "./core/plot.ts";
import { simulate, type SimulateOptions } from "./core/simulate.ts";
import type { Diagnostic, Program } from "./core/types.ts";
import { CHROME_HINT, findChrome, svgToPng } from "./node/chrome.ts";
import { compilePath } from "./node/load.ts";

const USAGE = `nudg <command> [options]

Commands
  validate <file...>        Check files. Exit code 1 if any has errors.
  simulate <file>           Send events, advance time, report states and values.
  plot <file>               Draw a motion graph: each property over time, with events,
                            targets, overshoot and settle times marked.

simulate and plot options
  --send <event@time>       Event and time, e.g. track.tap@0.1 or track.tap@100ms. Repeatable.
  --until <seconds>         Last sample time. Default: when everything settles.
  --every <seconds>         Sample interval (simulate only). Default: 0.05.
  --props <a,b,...>         Properties to report. Default: all.

plot options
  --out <file.svg|file.png> Where to write. PNG needs Chrome (or NUDG_CHROME). Default: SVG to stdout.
  --title <text>            Graph title. Default: the file name.

Common options
  --json                    Machine-readable output.
  --help                    Show this help.`;

interface Args {
  positional: string[];
  flags: Map<string, string[]>;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const [name, inline] = arg.slice(2).split(/=(.*)/s, 2);
    const boolean = name === "json" || name === "help";
    const value = boolean ? "" : (inline ?? argv[++i]);
    if (value === undefined) fail(`Option --${name} needs a value.`);
    flags.set(name, [...(flags.get(name) ?? []), value]);
  }
  return { positional, flags };
}

function fail(message: string): never {
  process.stderr.write(`nudg: ${message}\n`);
  process.exit(2);
}

function parseSeconds(raw: string, what: string): number {
  const m = /^(\d+\.?\d*|\.\d+)(ms|s)?$/.exec(raw);
  if (!m) fail(`${what} must be a time like 0.1 or 100ms, got "${raw}".`);
  return m[2] === "ms" ? Number(m[1]) / 1000 : Number(m[1]);
}

function formatDiagnostic(d: Diagnostic): string {
  const where = `${d.file ? `${d.file} ` : ""}${d.path || "/"}`;
  return [`  ${d.severity} ${d.code} at ${where}`, `    ${d.message}`, ...(d.hint ? [`    hint: ${d.hint}`] : [])].join("\n");
}

function load(file: string) {
  if (!existsSync(file)) fail(`File not found: ${file}`);
  return compilePath(file);
}

function validate(args: Args, json: boolean): number {
  if (args.positional.length === 0) fail("validate needs at least one file.");
  const results = args.positional.map((file) => ({ file, diagnostics: load(file).diagnostics }));
  const failed = results.some((r) => r.diagnostics.some((d) => d.severity === "error"));
  if (json) {
    process.stdout.write(JSON.stringify({ ok: !failed, results }, null, 2) + "\n");
  } else {
    for (const { file, diagnostics } of results) {
      const errors = diagnostics.filter((d) => d.severity === "error").length;
      const warnings = diagnostics.length - errors;
      const status = errors ? `${errors} error${errors > 1 ? "s" : ""}` : "ok";
      process.stdout.write(`${file}: ${status}${warnings ? `, ${warnings} warning${warnings > 1 ? "s" : ""}` : ""}\n`);
      for (const d of diagnostics) process.stdout.write(formatDiagnostic(d) + "\n");
    }
  }
  return failed ? 1 : 0;
}

/** Loads a file that must compile, reporting its diagnostics if it doesn't. */
function loadProgram(command: string, args: Args, json: boolean): { file: string; program?: Program; diagnostics: Diagnostic[] } {
  const file = args.positional[0];
  if (!file || args.positional.length > 1) fail(`${command} takes exactly one file.`);
  const { program, diagnostics } = load(file);
  if (!program) {
    if (json) process.stdout.write(JSON.stringify({ ok: false, diagnostics }, null, 2) + "\n");
    else {
      process.stdout.write(`${file}: can't ${command}, the file has errors\n`);
      for (const d of diagnostics) process.stdout.write(formatDiagnostic(d) + "\n");
    }
  }
  return { file, program, diagnostics };
}

function simulationOptions(args: Args, program: Program): SimulateOptions {
  const events = (args.flags.get("send") ?? []).map((raw) => {
    const at = raw.lastIndexOf("@");
    if (at <= 0) fail(`--send expects event@time, e.g. track.tap@0.1, got "${raw}".`);
    return { event: raw.slice(0, at), t: parseSeconds(raw.slice(at + 1), "--send time") };
  });
  const until = args.flags.get("until")?.at(-1);
  const every = args.flags.get("every")?.at(-1);
  const props = args.flags.get("props")?.at(-1);
  const properties = props?.split(",").map((p) => p.trim()).filter(Boolean);
  for (const p of properties ?? []) {
    if (!program.properties.has(p)) fail(`Unknown property "${p}". Properties: ${[...program.properties.keys()].join(", ")}.`);
  }
  return {
    events,
    until: until === undefined ? undefined : parseSeconds(until, "--until"),
    every: every === undefined ? undefined : parseSeconds(every, "--every"),
    properties,
  };
}

function runSimulate(args: Args, json: boolean): number {
  const { program, diagnostics } = loadProgram("simulate", args, json);
  if (!program) return 1;
  const options = simulationOptions(args, program);
  const properties = options.properties;
  const result = simulate(program, options);

  if (json) {
    process.stdout.write(JSON.stringify({ ok: true, ...result, diagnostics }, null, 2) + "\n");
    return 0;
  }

  const keys = properties ?? [...program.properties.keys()];
  const fmt = (v: unknown) => (typeof v === "number" ? v.toFixed(3) : String(v));
  const rows = result.samples.map((s) => [s.t.toFixed(3), s.state.join(" "), ...keys.map((k) => fmt(s.values[k]))]);
  const header = ["t", "state", ...keys];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join("  ").trimEnd();
  process.stdout.write([line(header), ...rows.map(line)].join("\n") + "\n\nsummary\n");
  const keyWidth = Math.max(...keys.map((k) => k.length));
  for (const key of keys) {
    const s = result.summary[key];
    const parts = [`final ${fmt(s.final)}`];
    if (s.min !== undefined && s.max !== undefined) parts.push(`min ${fmt(s.min)}`, `max ${fmt(s.max)}`);
    parts.push(s.settledAt === undefined ? "still moving" : `at rest from ${s.settledAt.toFixed(3)}s`);
    process.stdout.write(`  ${key.padEnd(keyWidth)}  ${parts.join("  ")}\n`);
  }
  if (result.unhandled.length) {
    process.stdout.write(`\nunhandled: ${result.unhandled.map((e) => `${e.event}@${e.t}`).join(", ")}\n`);
  }
  for (const d of diagnostics) process.stdout.write(formatDiagnostic(d) + "\n");
  return 0;
}

function runPlot(args: Args, json: boolean): number {
  const { file, program, diagnostics } = loadProgram("plot", args, json);
  if (!program) return 1;
  const options = simulationOptions(args, program);
  const title = args.flags.get("title")?.at(-1) ?? basename(file);
  const result = plot(program, { ...options, every: undefined, title });
  const out = args.flags.get("out")?.at(-1);

  if (!out) {
    if (json) fail("plot --json needs --out, so the JSON can say where the graph went.");
    process.stdout.write(result.svg + "\n");
    return 0;
  }
  const ext = extname(out).toLowerCase();
  if (ext === ".png") {
    const chrome = findChrome();
    if (!chrome) fail(`Writing a PNG needs a browser. ${CHROME_HINT} Or write an .svg.`);
    svgToPng(result.svg, result.width, result.height, out, chrome);
  } else if (ext === ".svg") {
    writeFileSync(out, result.svg + "\n");
  } else {
    fail(`--out must end in .svg or .png, got "${out}".`);
  }

  if (json) {
    process.stdout.write(JSON.stringify({ ok: true, out, summary: result.simulation.summary, unhandled: result.simulation.unhandled, diagnostics }, null, 2) + "\n");
  } else {
    process.stdout.write(`wrote ${out}\n`);
    if (result.simulation.unhandled.length) {
      process.stdout.write(`unhandled: ${result.simulation.unhandled.map((e) => `${e.event}@${e.t}`).join(", ")}\n`);
    }
  }
  return 0;
}

const args = parseArgs(process.argv.slice(2));
const json = args.flags.has("json");
const command = args.positional.shift();
if (!command || args.flags.has("help") || command === "help") {
  process.stdout.write(USAGE + "\n");
  process.exit(0);
}
if (command === "validate") process.exit(validate(args, json));
if (command === "simulate") process.exit(runSimulate(args, json));
if (command === "plot") process.exit(runPlot(args, json));
fail(`Unknown command "${command}". Commands: validate, simulate, plot.`);
