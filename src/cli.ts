#!/usr/bin/env node
// nudg CLI. Every command takes --json so an agent can read the result directly.

import { existsSync, writeFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { plot } from "./core/plot.ts";
import { describeEvent, dragGesture, simulate, type SimulateOptions, type TimedEvent } from "./core/simulate.ts";
import type { Diagnostic, Program } from "./core/types.ts";
import { CHROME_HINT, findChrome, svgToPng } from "./node/chrome.ts";
import { formatDiagnostic, formatSamples, formatStatus, formatSummary } from "./node/format.ts";
import { compilePath } from "./node/load.ts";
import { serveMcp } from "./node/mcp.ts";
import { frameTimes, renderFrames } from "./node/render.ts";

const USAGE = `nudg <command> [options]

Commands
  validate <file...>        Check files. Exit code 1 if any has errors.
  simulate <file>           Send events, advance time, report states and values.
  plot <file>               Draw a motion graph: each property over time, with events,
                            targets, overshoot and settle times marked.

simulate and plot options
  --send <event@time>       Event and time, e.g. track.tap@0.1 or track.tap@100ms. Repeatable.
  --drag <t:dx[,dy]@a-b>    A drag on target t by (dx, dy) from time a to b, e.g. track:20@0.1-0.3.
                            Sends down, dragstart, 60 input samples per second, up, dragend.
  --input <name=v@time>     One input sample, e.g. track.drag.x=12@0.2. Repeatable.
  --start <path,...>        Start in these states instead of initial, e.g. on.
  --reduced-motion          Play as a reduced-motion user would see it (0.3).
  --until <seconds>         Last sample time. Default: when everything settles.
  --every <seconds>         Sample interval (simulate only). Default: 0.05.
  --props <a,b,...>         Properties to report. Default: all.

  mcp                       Run the MCP server on stdio (tools: nudg_guide, nudg_validate,
                            nudg_simulate, nudg_plot, nudg_render).
  render <file>             Draw real frames of the component with headless Chrome, as one
                            filmstrip PNG. Uses the page's markup and styles; its scripts don't run.

plot options
  --out <file.svg|file.png> Where to write. PNG needs Chrome (or NUDG_CHROME). Default: SVG to stdout.
  --title <text>            Graph title. Default: the file name.

render options
  --html <page.html>        Page with the component's markup (data-nudg names) and styles. Required.
  --at <seconds>            A frame time. Repeatable. Default: evenly spaced frames until at rest.
  --frames <n>              Number of evenly spaced frames when --at is not given. Default: 6.
  --out <file.png>          Where to write. Required.

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
    const boolean = name === "json" || name === "help" || name === "reduced-motion";
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
      process.stdout.write(`${file}: ${formatStatus(diagnostics)}\n`);
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
  const events: TimedEvent[] = (args.flags.get("send") ?? []).map((raw) => {
    const at = raw.lastIndexOf("@");
    if (at <= 0) fail(`--send expects event@time, e.g. track.tap@0.1, got "${raw}".`);
    return { event: raw.slice(0, at), t: parseSeconds(raw.slice(at + 1), "--send time") };
  });
  for (const raw of args.flags.get("drag") ?? []) {
    const m = /^([^:]+):(-?[\d.]+)(?:,(-?[\d.]+))?@([\d.]+m?s?)-([\d.]+m?s?)$/.exec(raw);
    if (!m) fail(`--drag expects target:dx[,dy]@from-to, e.g. track:20@0.1-0.3, got "${raw}".`);
    const from = parseSeconds(m[4], "--drag start");
    const to = parseSeconds(m[5], "--drag end");
    if (!(to > from)) fail(`--drag must end after it starts, got "${raw}".`);
    events.push(...dragGesture(m[1], from, to, Number(m[2]), m[3] === undefined ? 0 : Number(m[3])));
  }
  for (const raw of args.flags.get("input") ?? []) {
    const m = /^([^=]+)=(-?[\d.]+)@(.+)$/.exec(raw);
    if (!m) fail(`--input expects name=value@time, e.g. track.drag.x=12@0.2, got "${raw}".`);
    events.push({ input: m[1], value: Number(m[2]), t: parseSeconds(m[3], "--input time") });
  }
  const start = args.flags.get("start")?.at(-1)?.split(",").map((p) => p.trim()).filter(Boolean);
  const until = args.flags.get("until")?.at(-1);
  const every = args.flags.get("every")?.at(-1);
  const props = args.flags.get("props")?.at(-1);
  const properties = props?.split(",").map((p) => p.trim()).filter(Boolean);
  for (const p of properties ?? []) {
    if (!program.properties.has(p)) fail(`Unknown property "${p}". Properties: ${[...program.properties.keys()].join(", ")}.`);
  }
  return {
    events,
    start,
    reducedMotion: args.flags.has("reduced-motion") || undefined,
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
  process.stdout.write(`${formatSamples(result, keys)}\n\nsummary\n${formatSummary(result, keys)}\n`);
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
      process.stdout.write(`unhandled: ${result.simulation.unhandled.map(describeEvent).join(", ")}\n`);
    }
  }
  return 0;
}

async function runRender(args: Args, json: boolean): Promise<number> {
  const { program } = loadProgram("render", args, json);
  if (!program) return 1;
  const file = args.positional[0];
  const html = args.flags.get("html")?.at(-1);
  if (!html) fail("render needs --html <page.html> with the component's markup. For a graph without markup, use nudg plot.");
  if (!existsSync(html)) fail(`File not found: ${html}`);
  const out = args.flags.get("out")?.at(-1);
  if (!out || extname(out).toLowerCase() !== ".png") fail("render needs --out <file.png>.");
  const chrome = findChrome();
  if (!chrome) fail(`render needs a browser. ${CHROME_HINT}`);

  const options = simulationOptions(args, program);
  let times = (args.flags.get("at") ?? []).map((raw) => parseSeconds(raw, "--at"));
  if (times.length === 0) {
    const frames = Number(args.flags.get("frames")?.at(-1) ?? 6);
    if (!Number.isInteger(frames) || frames < 1 || frames > 60) fail("--frames must be a whole number from 1 to 60.");
    times = frameTimes(program, options, frames);
  }
  times.sort((a, b) => a - b);

  const result = await renderFrames({ file, html, events: options.events, start: options.start, reducedMotion: options.reducedMotion, times, out, chrome });
  if (json) {
    process.stdout.write(JSON.stringify({ ok: true, ...result }, null, 2) + "\n");
  } else {
    process.stdout.write(`wrote ${out}\n`);
    for (const f of result.frames) process.stdout.write(`  ${f.t.toFixed(3)}s  ${f.state.join("  ")}\n`);
    if (result.unbound.length) process.stdout.write(`no element for: ${result.unbound.join(", ")} (add data-nudg="${result.unbound[0]}" to the page)\n`);
    if (result.unknown.length) process.stdout.write(`not targets in the file: ${result.unknown.join(", ")}\n`);
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
if (command === "render") process.exit(await runRender(args, json));
if (command === "mcp") {
  await serveMcp();
  process.exit(0);
}
fail(`Unknown command "${command}". Commands: validate, simulate, plot, render, mcp.`);
