#!/usr/bin/env node
// nudg CLI. Every command takes --json so an agent can read the result directly.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { compare, compareFrameTimes } from "./core/compare.ts";
import { contract, contractModule } from "./core/contract.ts";
import { critique } from "./core/critique.ts";
import { programToJson } from "./core/program-json.ts";
import { createRuntime } from "./core/runtime.ts";
import { plot } from "./core/plot.ts";
import { presets, type PresetName } from "./core/presets.ts";
import { describeEvent, dragGesture, simulate, type SimulateOptions, type TimedEvent } from "./core/simulate.ts";
import type { Diagnostic, Program } from "./core/types.ts";
import { CHROME_HINT, findChrome, openInBrowser, svgToPng } from "./node/chrome.ts";
import { snapshotElement } from "./node/snapshot.ts";
import { materializeRevision } from "./node/git.ts";
import { clearLog, formatSummary as formatLogSummary, logPath, readLog, record, shareableSummary, shareTip, shareUrl, struggle, summarize } from "./node/log.ts";
import { installSkill, SKILL } from "./node/skill.ts";
import { formatComparison, formatCritique, formatDiagnostic, formatObservation, formatSamples, formatStatus, formatSummary } from "./node/format.ts";
import { comparePage, lastRuntimeInlined, readWithImports } from "./node/compare-page.ts";
import { compilePath } from "./node/load.ts";
import { serveMcp } from "./node/mcp.ts";
import { frameTimes, renderFrames } from "./node/render.ts";
import { ACTIONS, checkAction, observe, type HostAction } from "./node/observe.ts";
import { actionTarget, actionsToEvents, judgeHost } from "./core/observe.ts";
import { findRecipe, formatGaps, formatRecipe, noStarter, recipeCatalog, recipeGaps, recipeSource } from "./node/recipes.ts";

/** The package version, for what --share reports. */
const VERSION_PKG: string = (() => {
  try {
    return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  } catch {
    return "unknown";
  }
})();

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
  --layout <t.m=v,...>      What the host would measure (0.4), e.g. tab2.x=96,tab2.width=88,
                            underline.x=8. Measured values without it fall back to their base.
  --start <path,...>        Start in these states instead of initial, e.g. on.
  --reduced-motion          Play as a reduced-motion user would see it (0.3).
  --until <seconds>         Last sample time. Default: when everything settles.
  --every <seconds>         Sample interval (simulate only). Default: 0.05.
  --props <a,b,...>         Properties to report. Default: all.

  log [--json|--path|--clear|--share]
                            What the judge loop looked like on this machine: compares,
                            verdicts, rounds per change. Local only (~/.nudg/log.jsonl);
                            NUDG_LOG=off turns logging off, NUDG_LOG=<file> moves it.
                            --share opens a prefilled GitHub issue with counts only;
                            --note "..." adds a line in your words.
  skill [--user|--print]    Install a Claude Code skill that teaches the agent the loop,
                            for this project (default) or for every project (--user).
  mcp                       Run the MCP server on stdio (tools: nudg_guide, nudg_validate,
                            nudg_simulate, nudg_plot, nudg_compare, nudg_render, nudg_observe).
  preset <name> [--options '{"scale":0.9}']
                            Print a preset (press, hover, toggle, toast) as a nudg file,
                            to save and edit: nudg preset press > press.nudg.json
  recipe [name] [--json|--source|--gaps]
                            List semantic interaction contracts, or resolve a human UI term
                            such as toggle, video chat or sheet. --source prints its starter file.
                            --gaps counts the capabilities the catalog is missing, most needed first.
  compare <a> <b>           Two versions under the same events: says first whether a person
                            would notice the difference, then shows it. --html gives real A/B
                            filmstrips in rows; without it, both curves on one graph.
  compare <file> --before <rev>
                            The same, against the file as it was at a git revision (HEAD,
                            HEAD~1, a branch): no copy of the "before" to keep around.
  render <file>             Draw real frames of the component with headless Chrome, as one
                            filmstrip PNG. Uses the page's markup and styles; its scripts don't run.
  compile <file> [--out x]  The file compiled for a native runtime (Swift, Kotlin): validated,
                            imports and named motions resolved, as plain JSON. Ship it with
                            the app; the runtime there reads it without a validator.
  generate <file...>        TypeScript names for the host: writes x.nudg.ts beside x.nudg.json with
                            its targets, events, inputs and state paths (imports included), for
                            useNudg<XContract>(x). --check writes nothing and exits 1 if a module
                            is missing or stale (for CI). --out <file.ts> with one file.
  critique <file...>        Whether the motion is good, not only valid: each transition checked
                            against the platforms' motion guidelines and accessibility rules
                            (slow transitions, late press feedback, invisible changes, bouncy
                            fades, slow exits, short timeouts, dialogs without Escape).
                            --strict exits 1 on warnings.
  observe <url|page.html>   Host truth: open the real page (scripts and all) in headless Chrome,
                            do what a finger would, measure the element every frame, and say
                            what the page actually showed. With --file, judge it against the file.

plot options
  --out <file.svg|file.png> Where to write. PNG needs Chrome (or NUDG_CHROME). Default: SVG to stdout.
  --title <text>            Graph title. Default: the file name.

compare options
  --url <url|page.html>     The running app (or a local page, served from the working directory):
                            the component is snapshotted from it, styles and all, and the
                            side-by-side page is written from that. No --html needed.
  --select <css>            Which element to snapshot. Default: the smallest element holding
                            every bound target (a toggle's track with its knob).
  --open                    Open the page in the browser once written.
  --html <page.html>        Real markup. With --out x.html: a page that plays A and B side by side
                            in a loop with slow motion, for a person to judge (needs a browser, not
                            Chrome). With --out x.png: A/B filmstrip rows (needs Chrome).
  --out <file.html|png|svg> Where to write. Default: graph as SVG to stdout, or compare.png with --html.
  --at / --frames           Frame times, as for render.
  --labels <A,B>            Names for the two versions.

observe options
  --select <css>            The element to measure (shadow roots included). Default, with --file:
                            [data-nudg="<the file's first target>"].
  --do <action@time>        An action on it: down, up, tap, hover, leave, or key:<name>, e.g.
                            tap@0.1 or key:escape@0.5. Repeatable. The page's own handlers run.
  --file <x.nudg.json>      The file the page should be playing. Its events default to the actions,
                            on the first target that handles them (a toggle's track, not its
                            knob), at the times they happened; --send overrides them.
  --on <target>             Which target the actions are for, when the file's choice is wrong.
                            Exit codes: 0 played, 1 the page didn't play the file, 2 couldn't observe.
  --settle <seconds>        How long to keep measuring after the last action. Default: 1.5.
  --warmup <seconds>        How long to let the page's scripts start first. Default: 0.5.
  --viewport <w>x<h>        Window size, e.g. 390x844 for a phone.

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
    const boolean = ["json", "help", "reduced-motion", "open", "clear", "path", "print", "user", "share", "strict", "source", "check", "gaps"].includes(name);
    const value = boolean ? "" : (inline ?? argv[++i]);
    if (value === undefined || (!boolean && (value === "" || value.startsWith("--")))) fail(`Option --${name} needs a value.`);
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
  record({ via: "cli", tool: "validate", files: args.positional, verdict: failed ? "errors" : "ok" });
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
  // Layout (0.4): what the host would report, at time 0, before any event.
  const layout: TimedEvent[] = [];
  for (const raw of (args.flags.get("layout") ?? []).flatMap((l) => l.split(","))) {
    const m = /^\s*([^.=\s]+)\.([A-Za-z]+)\s*=\s*(-?[\d.]+)\s*$/.exec(raw);
    if (!m) fail(`--layout expects target.measurement=value, e.g. seg2.x=72,seg2.width=88, got "${raw}".`);
    layout.push({ input: `${m[1]}.layout.${m[2]}`, value: Number(m[3]), t: 0 });
  }
  events.unshift(...layout);
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
  const missing = unmeasuredIn(program, options.events);
  if (missing.length) process.stdout.write(`note: not measured, so falling back to base values: ${missing.join(", ")}. Pass --layout ${missing.map((n) => n.replace(".layout.", ".") + "=…").join(",")}.\n`);
  for (const d of diagnostics) process.stdout.write(formatDiagnostic(d) + "\n");
  return 0;
}

/** Layout inputs the program reads that the events never report. */
function unmeasuredIn(program: Program, events: TimedEvent[]): string[] {
  const reported = new Set(events.flatMap((e) => ("input" in e ? [e.input] : [])));
  return createRuntime(program).measurements().filter((n) => !reported.has(n));
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

async function runCompare(args: Args, json: boolean): Promise<number> {
  try {
    const code = await compareCommand(args, json);
    if (!json) {
      // A change that keeps needing rounds is the most useful thing to hear about.
      const hard = args.positional.length ? struggle(args.positional.at(-1)!) : undefined;
      const tip = hard
        ? `This change has taken ${hard.rounds} rounds. If something made it hard (a verdict that was off, a word that didn't map), please tell the project:\n  nudg log --share --note "what made it take ${hard.rounds} rounds"\nIt sends counts and your note, nothing about your app, as an issue you submit yourself.`
        : shareTip();
      if (tip) process.stdout.write(`\n${tip}\n`);
    }
    return code;
  } finally {
    // The materialized "before" is read during the run and never needed after it.
    if (beforeDirToClean) rmSync(beforeDirToClean, { recursive: true, force: true });
    beforeDirToClean = undefined;
  }
}

let beforeDirToClean: string | undefined;

async function compareCommand(args: Args, json: boolean): Promise<number> {
  const before = args.flags.get("before")?.at(-1);
  let fileA: string;
  let fileB: string;
  let beforeDir: string | undefined;
  if (before) {
    if (args.positional.length !== 1) fail("compare --before <rev> takes one file: the changed one; the revision supplies the other.");
    fileB = args.positional[0];
    beforeDir = mkdtempSync(join(tmpdir(), "nudg-before-"));
    try {
      fileA = materializeRevision(fileB, before, beforeDir);
      beforeDirToClean = beforeDir;
    } catch (e) {
      rmSync(beforeDir, { recursive: true, force: true });
      fail((e as Error).message);
    }
  } else {
    [fileA, fileB] = args.positional;
    if (!fileA || !fileB || args.positional.length !== 2) fail("compare takes exactly two files: the current version and the changed one (or one file with --before <rev>).");
  }
  const a = load(fileA);
  const b = load(fileB);
  for (const [file, result] of [[fileA, a], [fileB, b]] as const) {
    if (!result.program) {
      process.stdout.write(`${file}: can't compare, the file has errors\n`);
      for (const d of result.diagnostics) process.stdout.write(formatDiagnostic(d) + "\n");
      return 1;
    }
  }
  const options = simulationOptions(args, a.program!);
  const labels = (args.flags.get("labels")?.at(-1)?.split(",").map((s) => s.trim()) ?? (before ? [before, "now"] : ["A", "B"])) as [string, string];
  const comparison = compare(a.program!, b.program!, options);
  const logged = (opened = false) => record({ via: "cli", tool: "compare", files: [...new Set(args.positional)], before, url, verdict: comparison.identical ? "identical" : comparison.verdict, headline: comparison.headline, opened });
  let html = args.flags.get("html")?.at(-1);
  let out = args.flags.get("out")?.at(-1);
  const url = args.flags.get("url")?.at(-1);
  let snapshotHtml: string | undefined;
  const notes: string[] = [];
  if (url) {
    // From the running app: snapshot the component, then it's the --html case with a page as the deliverable.
    if (html) fail("--url snapshots the component from the page; drop --html.");
    const chrome = findChrome();
    if (!chrome) fail(`--url needs a browser to snapshot the page. ${CHROME_HINT}`);
    let snap;
    try {
      snap = await snapshotElement({ url, selector: args.flags.get("select")?.at(-1), targets: a.program!.targets, chrome });
    } catch (e) {
      fail(`couldn't snapshot ${url}: ${(e as Error).message}`);
    }
    snapshotHtml = snap.html;
    html = url;
    out ??= join(tmpdir(), "nudg-compare.html");
    if (extname(out).toLowerCase() !== ".html") fail("With --url the deliverable is the side-by-side page; use --out <file.html> or leave --out out.");
    notes.push(`snapshot of ${snap.selector}: ${snap.fidelity.elements} elements, ${snap.fidelity.declarations} style declarations inlined`, ...snap.notes);
  }
  if (out && extname(out).toLowerCase() === ".html" && !html) fail("--out x.html writes the side-by-side page and needs --html <page.html> with the component's markup, or --url <the running app>. For a graph, write .svg or .png.");
  let picture: string | undefined;

  if (comparison.identical && url) {
    // Nothing to show a person; say so instead of opening a page with two identical stages.
    process.stdout.write(formatComparison(comparison, labels) + "\n");
    for (const n of notes) process.stdout.write(`note: ${n}\n`);
    logged();
    return 0;
  }
  if (html && out && extname(out).toLowerCase() === ".html") {
    if (!snapshotHtml && !existsSync(html)) fail(`File not found: ${html}`);
    const untilBoth = Math.max(comparison.a.samples.at(-1)!.t, comparison.b.samples.at(-1)!.t);
    writeFileSync(out, comparePage({ html: snapshotHtml ?? readFileSync(html, "utf8"), a: readWithImports(fileA), b: readWithImports(fileB), labels, events: options.events, until: untilBoth, start: options.start, reducedMotion: options.reducedMotion, headline: comparison.headline }));
    picture = out;
  } else if (html) {
    if (!existsSync(html)) fail(`File not found: ${html}`);
    const chrome = findChrome();
    if (!chrome) fail(`Filmstrips need a browser. ${CHROME_HINT} Or drop --html for a graph.`);
    let times = (args.flags.get("at") ?? []).map((raw) => parseSeconds(raw, "--at"));
    let marks: Record<string, string> = {};
    if (times.length === 0) ({ times, marks } = compareFrameTimes(comparison, Number(args.flags.get("frames")?.at(-1) ?? 6)));
    picture = out ?? "compare.png";
    if (extname(picture).toLowerCase() !== ".png") fail("With --html the picture is a PNG; use --out <file.png>.");
    try {
      await renderFrames({ file: fileA, label: labels[0], variants: [{ file: fileB, label: labels[1] }], html, events: options.events, start: options.start, reducedMotion: options.reducedMotion, times, marks, out: picture, chrome, roots: beforeDir ? [beforeDir] : [] });
    } catch (e) {
      fail(`couldn't render the filmstrip: ${(e as Error).message}`);
    }
  } else {
    const graph = plot(a.program!, { ...options, every: undefined, against: b.program!, labels, title: `${basename(fileA)} vs ${basename(fileB)}` });
    if (out && extname(out).toLowerCase() === ".png") {
      const chrome = findChrome();
      if (!chrome) fail(`Writing a PNG needs a browser. ${CHROME_HINT} Or write an .svg.`);
      svgToPng(graph.svg, graph.width, graph.height, out, chrome);
      picture = out;
    } else if (out) {
      writeFileSync(out, graph.svg + "\n");
      picture = out;
    } else if (!json) {
      process.stdout.write(formatComparison(comparison, labels) + "\n\n" + graph.svg + "\n");
      logged();
      return 0;
    }
  }

  const opened = picture?.endsWith(".html") && args.flags.has("open") ? openInBrowser(picture) : false;
  logged(opened);
  if (json) {
    const { a: _a, b: _b, ...rest } = comparison;
    process.stdout.write(JSON.stringify({ ok: true, ...rest, summaryA: comparison.a.summary, summaryB: comparison.b.summary, picture, opened, notes }, null, 2) + "\n");
  } else {
    process.stdout.write(formatComparison(comparison, labels) + "\n");
    for (const n of notes) process.stdout.write(`note: ${n}\n`);
    if (picture) process.stdout.write(`\nwrote ${picture}${picture.endsWith(".html") ? (opened ? ` — opened in your browser: left is ${labels[0]} (before), right is ${labels[1]} (the change)` : " — open it in a browser: both versions play side by side, with slow motion") : ""}\n`);
    if (picture?.endsWith(".html") && !lastRuntimeInlined) process.stdout.write("note: the runtime isn't built here, so the page loads @nudg/core from unpkg; run npm run build for an offline page\n");
  }
  return 0;
}

async function runObserve(args: Args, json: boolean): Promise<number> {
  const url = args.positional[0];
  if (!url || args.positional.length > 1) fail("observe takes one URL or page path.");
  const file = args.flags.get("file")?.at(-1);
  let program: Program | undefined;
  if (file) {
    const loaded = load(file);
    if (!loaded.program) {
      process.stdout.write(`${file}: can't observe against it, the file has errors\n`);
      for (const d of loaded.diagnostics) process.stdout.write(formatDiagnostic(d) + "\n");
      return 1;
    }
    program = loaded.program;
  }
  const target = program ? [...program.properties.keys()][0]?.split(".")[0] : undefined;
  const selector = args.flags.get("select")?.at(-1) ?? (target ? `[data-nudg="${target}"]` : undefined);
  if (!selector) fail("observe needs --select <css> (or --file, whose first animated target names the element).");
  const on = args.flags.get("on")?.at(-1);
  if (on && program && !program.targets.includes(on)) fail(`--on ${on}: the file has no such target (it has ${program.targets.join(", ")}).`);
  const actions: HostAction[] = (args.flags.get("do") ?? []).map((raw) => {
    const at = raw.lastIndexOf("@");
    if (at <= 0) fail(`--do expects action@time, e.g. tap@0.1, got "${raw}".`);
    const action = raw.slice(0, at);
    const problem = checkAction(action);
    if (problem) fail(problem);
    return { action, t: parseSeconds(raw.slice(at + 1), "--do time") };
  });
  if (actions.length === 0) fail(`observe needs at least one --do <action@time>. Actions are ${ACTIONS}.`);
  const chrome = findChrome();
  if (!chrome) fail(`observe needs a browser. ${CHROME_HINT}`);
  const settle = args.flags.get("settle")?.at(-1);
  const warmup = args.flags.get("warmup")?.at(-1);
  const vp = args.flags.get("viewport")?.at(-1);
  const viewport = vp ? (() => {
    const m = /^(\d+)x(\d+)$/.exec(vp);
    if (!m) fail(`--viewport expects <w>x<h>, e.g. 390x844, got "${vp}".`);
    return { width: Number(m[1]), height: Number(m[2]) };
  })() : undefined;
  let observation;
  try {
    observation = await observe({ url, selector, actions, chrome, settle: settle ? parseSeconds(settle, "--settle") : undefined, warmup: warmup ? parseSeconds(warmup, "--warmup") : undefined, viewport });
  } catch (e) {
    fail(`couldn't observe: ${(e as Error).message}`);
  }

  let judgement;
  let simulation;
  if (program) {
    const options = simulationOptions(args, program);
    if (options.events.length === 0) options.events = actionsToEvents((action) => on ?? actionTarget(program, action), observation.series.marks);
    const last = observation.series.samples.at(-1)?.t ?? 0;
    simulation = simulate(program, { ...options, until: options.until ?? Math.max(last, options.events.at(-1)?.t ?? 0) });
    judgement = judgeHost(simulation, observation.summary, { target });
  }
  if (json) {
    process.stdout.write(JSON.stringify({ ok: true, url, selector, marks: observation.series.marks, summary: observation.summary, unmountedAt: observation.series.unmountedAt, errors: observation.errors, judgement, file: simulation ? { summary: simulation.summary } : undefined, samples: observation.series.samples }, null, 2) + "\n");
  } else {
    process.stdout.write(formatObservation({ url, selector, summary: observation.summary, marks: observation.series.marks, errors: observation.errors }, judgement) + "\n");
  }
  record({ via: "cli", tool: "observe", files: file ? [file] : [], url, verdict: judgement?.verdict ?? "measured", headline: judgement?.headline });
  if (judgement?.verdict === "unmeasured") return 2;
  return judgement && judgement.verdict !== "played" ? 1 : 0;
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

function runGenerate(args: Args, json: boolean): number {
  if (args.positional.length === 0) fail("generate needs at least one file.");
  const out = args.flags.get("out")?.at(-1);
  if (out && args.positional.length > 1) fail("--out takes one file; without it each module goes beside its file.");
  const check = args.flags.has("check");
  const results: { file: string; out: string; status: "written" | "unchanged" | "stale" | "missing" | "errors"; diagnostics?: Diagnostic[] }[] = [];
  for (const file of args.positional) {
    if (!out && !file.endsWith(".json")) fail(`${file}: expected a .json file, or pass --out.`);
    const target = out ?? file.replace(/\.json$/, ".ts");
    const { program, diagnostics } = load(file);
    if (!program) {
      results.push({ file, out: target, status: "errors", diagnostics });
      continue;
    }
    const text = contractModule(contract(program), file);
    const current = existsSync(target) ? readFileSync(target, "utf8") : undefined;
    if (current === text) results.push({ file, out: target, status: "unchanged" });
    else if (check) results.push({ file, out: target, status: current === undefined ? "missing" : "stale" });
    else {
      writeFileSync(target, text);
      results.push({ file, out: target, status: "written" });
    }
  }
  const failed = results.some((r) => r.status === "errors" || r.status === "stale" || r.status === "missing");
  if (json) process.stdout.write(JSON.stringify({ ok: !failed, results }, null, 2) + "\n");
  else
    for (const r of results) {
      if (r.status === "errors") {
        process.stdout.write(`${r.file}: can't generate, the file has errors\n`);
        for (const d of r.diagnostics!) process.stdout.write(formatDiagnostic(d) + "\n");
      } else if (r.status === "stale" || r.status === "missing") process.stdout.write(`${r.out}: ${r.status}, run \`nudg generate ${r.file}\`\n`);
      else process.stdout.write(`${r.out}: ${r.status}\n`);
    }
  return failed ? 1 : 0;
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
if (command === "observe") process.exit(await runObserve(args, json));
if (command === "compile") {
  const file = args.positional[0];
  if (!file || args.positional.length > 1) fail("compile takes exactly one file.");
  const { program, diagnostics } = load(file);
  if (!program) {
    process.stdout.write(`${file}: can't compile, the file has errors\n`);
    for (const d of diagnostics) process.stdout.write(formatDiagnostic(d) + "\n");
    process.exit(1);
  }
  const text = JSON.stringify(programToJson(program), null, 1) + "\n";
  const out = args.flags.get("out")?.at(-1);
  if (out) {
    writeFileSync(out, text);
    process.stdout.write(`wrote ${out}\n`);
  } else process.stdout.write(text);
  process.exit(0);
}
if (command === "generate") process.exit(runGenerate(args, json));
if (command === "critique") {
  if (args.positional.length === 0) fail("critique needs at least one file.");
  let warnings = 0;
  const all: unknown[] = [];
  for (const file of args.positional) {
    const { program, diagnostics } = load(file);
    if (!program) {
      process.stdout.write(`${file}: can't critique, the file has errors\n`);
      for (const d of diagnostics) process.stdout.write(formatDiagnostic(d) + "\n");
      process.exit(1);
    }
    const { findings, transitions } = critique(program);
    warnings += findings.filter((f) => f.severity === "warning").length;
    if (json) all.push({ file, findings, transitions: transitions.length });
    else process.stdout.write(formatCritique(file, findings, transitions.length) + "\n");
  }
  if (json) process.stdout.write(JSON.stringify({ ok: true, results: all }, null, 2) + "\n");
  process.exit(args.flags.has("strict") && warnings > 0 ? 1 : 0);
}
if (command === "compare") process.exit(await runCompare(args, json));
if (command === "recipe") {
  if (args.positional.length > 1) fail("recipe takes at most one name.");
  const name = args.positional[0];
  if (args.flags.has("gaps")) {
    if (name) fail("recipe --gaps takes no name.");
    const gaps = recipeGaps();
    process.stdout.write(json ? JSON.stringify({ gaps }, null, 2) + "\n" : formatGaps(gaps) + "\n");
    process.exit(0);
  }
  if (!name) {
    if (args.flags.has("source")) fail("recipe --source needs a recipe name.");
    const recipes = recipeCatalog().recipes;
    process.stdout.write(
      json
        ? JSON.stringify({ recipes }, null, 2) + "\n"
        : recipes.map((recipe) => `${recipe.id.padEnd(21)} ${recipe.starter ? "" : "(no starter) "}${recipe.summary}`).join("\n") + "\n",
    );
    process.exit(0);
  }
  const recipe = findRecipe(name);
  if (!recipe) fail(`Unknown recipe "${name}". Run nudg recipe to list names and aliases.`);
  if (args.flags.has("source")) {
    const source = recipeSource(recipe);
    if (!source) fail(noStarter(recipe));
    process.stdout.write(source);
  }
  else process.stdout.write(json ? JSON.stringify(recipe, null, 2) + "\n" : formatRecipe(recipe) + "\n");
  process.exit(0);
}
if (command === "preset") {
  const name = args.positional[0] as PresetName | undefined;
  if (!name || !(name in presets)) fail(`preset needs one of: ${Object.keys(presets).join(", ")}.`);
  let options: Record<string, unknown> = {};
  const raw = args.flags.get("options")?.at(-1);
  if (raw !== undefined) {
    try {
      options = JSON.parse(raw);
    } catch {
      fail(`--options must be JSON, e.g. --options '{"scale":0.9}'.`);
    }
  }
  process.stdout.write(JSON.stringify(presets[name!](options), null, 2) + "\n");
  process.exit(0);
}
if (command === "log") {
  const path = logPath();
  if (args.flags.has("clear")) {
    clearLog(path);
    process.stdout.write(path ? `cleared ${path}\n` : "The log is off (NUDG_LOG=off).\n");
    process.exit(0);
  }
  if (args.flags.has("path")) {
    process.stdout.write((path ?? "off") + "\n");
    process.exit(0);
  }
  const summary = summarize(readLog(path));
  if (args.flags.has("share")) {
    if (summary.compare.calls + summary.observe.calls === 0) {
      process.stdout.write("Nothing to share yet: the log has no compare or observe calls.\n");
      process.exit(0);
    }
    const shared = shareableSummary(summary, VERSION_PKG);
    const note = args.flags.get("note")?.at(-1);
    const url = shareUrl(shared, note);
    process.stdout.write(`This is everything that would be shared (counts only, nothing about your app):\n\n${JSON.stringify(shared, null, 2)}\n\n`);
    const opened = openInBrowser(url);
    process.stdout.write(opened ? "Opened a prefilled GitHub issue in your browser; read it, then submit. Thank you.\n" : `Open this to file it as a GitHub issue:\n${url}\n`);
    process.exit(0);
  }
  process.stdout.write(json ? JSON.stringify({ path: path ?? null, ...summary }, null, 2) + "\n" : formatLogSummary(summary, path) + "\n");
  process.exit(0);
}
if (command === "skill") {
  if (args.flags.has("print")) {
    process.stdout.write(SKILL);
    process.exit(0);
  }
  const path = installSkill(args.flags.has("user") ? "user" : "project");
  process.stdout.write(`wrote ${path}\nClaude Code picks it up as /nudg; it tells the agent the say, see, judge loop.\n`);
  process.exit(0);
}
if (command === "mcp") {
  await serveMcp();
  process.exit(0);
}
fail(`Unknown command "${command}". Commands: validate, simulate, plot, render, compare, compile, critique, observe, recipe, preset, log, skill, mcp.`);
