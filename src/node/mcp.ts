// MCP server over stdio: newline-delimited JSON-RPC 2.0. Exposes the same capabilities
// as the CLI as tools, so an agent can write, check, and look at interactions.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { compile, type CompileResult } from "../core/compile.ts";
import { compare, compareFrameTimes } from "../core/compare.ts";
import { actionTarget, actionsToEvents, judgeHost } from "../core/observe.ts";
import { plot } from "../core/plot.ts";
import { dragGesture, simulate, type SimulateOptions, type TimedEvent } from "../core/simulate.ts";
import type { Program } from "../core/types.ts";
import { VERSION } from "../core/vocabulary.ts";
import { CHROME_HINT, findChrome, svgToPng } from "./chrome.ts";
import { formatComparison, formatDiagnostic, formatObservation, formatSamples, formatStatus, formatSummary } from "./format.ts";
import { comparePage, lastRuntimeInlined, readWithImports } from "./compare-page.ts";
import { compilePath } from "./load.ts";
import { ACTIONS, checkAction, observe, type HostAction } from "./observe.ts";
import { frameTimes, renderFrames } from "./render.ts";

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const GUIDE = resolve(dirname(fileURLToPath(import.meta.url)), "../../spec/guide.md");

const INSTRUCTIONS = `nudg files (*.nudg.json) describe UI interactions: states, events, and spring or tween motion.
If you haven't written one before, call nudg_guide first. After any edit, call nudg_validate and apply its hints until it reports no errors.
When you change motion for a person to judge, call nudg_compare with the version before and after: it says first whether the difference is perceptible, then shows both side by side (real A/B filmstrips when the host page's HTML is given). Pass its headline on to the person; if it suggests an exaggerated version, offer that. Use nudg_simulate for numbers, nudg_plot for one version's graph, nudg_render for one version's frames. The file says what should happen; nudg_observe says what the real page showed: after wiring a file into an app, or when the person says it doesn't look right, call it with the running page's URL and the file, and report what it found (a page that never shows the motion, an element that unmounts mid-motion, a CSS transition fighting the spring).`;

type Json = Record<string, unknown>;
type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
interface ToolResult {
  content: Content[];
  structuredContent?: Json;
  isError?: boolean;
}

/** Thrown inside a tool to return an error result the model can act on. */
class ToolError extends Error {}

const source = {
  file: { type: "string", description: "Path to a .nudg.json file, relative to the working directory." },
  source: { type: "string", description: "The file's JSON text, to check before writing it. Imports resolve relative to `path`, or the working directory." },
  path: { type: "string", description: "With `source`: where the text would live, for resolving imports and labeling." },
};
const timing = {
  events: {
    type: "array",
    description:
      "What happens, in time order. Each item is an event { \"event\": \"track.tap\", \"t\": 0.1 }, an input sample { \"input\": \"track.drag.x\", \"value\": 12, \"t\": 0.2 }, or a whole drag { \"drag\": \"track\", \"t\": 0.1, \"until\": 0.3, \"dx\": 20 } (down, dragstart, 60 samples per second, up, dragend).",
    items: {
      type: "object",
      properties: {
        event: { type: "string", description: "target.event, e.g. track.tap" },
        input: { type: "string", description: "target.drag.x or target.drag.y" },
        value: { type: "number", description: "The input's value (with `input`)." },
        drag: { type: "string", description: "Target to drag (with `until` and `dx`/`dy`)." },
        until: { type: ["number", "string"], description: "When the drag is released (with `drag`)." },
        dx: { type: "number", description: "Horizontal travel of the drag, in logical units." },
        dy: { type: "number", description: "Vertical travel of the drag, in logical units." },
        t: { type: ["number", "string"], description: "Seconds, or a string like \"100ms\". For a drag, when it starts." },
      },
      required: ["t"],
    },
  },
  start: { type: "array", items: { type: "string" }, description: "Start in these states instead of initial, e.g. [\"on\"]." },
  reducedMotion: { type: "boolean", description: "Play as a reduced-motion user would see it: short linear tweens, no kicks (0.3)." },
  until: { type: ["number", "string"], description: "Last time to look at. Default: when everything has come to rest." },
  properties: { type: "array", items: { type: "string" }, description: "Properties to report, e.g. [\"knob.x\"]. Default: all." },
};

const TOOLS = [
  {
    name: "nudg_guide",
    title: "nudg format guide",
    description: "The nudg format in one page: skeleton, vocabulary, motion forms, structure rules, and which field to change for requests like \"bouncier\" or \"snappier\". Read it before writing your first nudg file.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: "nudg_validate",
    title: "Validate a nudg file",
    description: "Check a nudg file. Each problem has a stable code, a JSON pointer path, and a hint that says how to fix it. Pass `file`, or `source` to check text before writing it.",
    inputSchema: { type: "object", properties: source },
    annotations: { readOnlyHint: true },
  },
  {
    name: "nudg_simulate",
    title: "Simulate a nudg file",
    description: "Send events at given times without rendering anything, and get active states and property values over time, plus a per-property summary: min, max, final value, and when it came to rest.",
    inputSchema: {
      type: "object",
      properties: { ...source, ...timing, every: { type: ["number", "string"], description: "Seconds between samples. Default 0.05." } },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "nudg_plot",
    title: "Plot motion",
    description: "Draw a motion graph image: each property over time with state bands, events, targets, overshoot (max/min) and settle times. Good for judging feel, e.g. comparing bounce before and after an edit.",
    inputSchema: {
      type: "object",
      properties: { ...source, ...timing, out: { type: "string", description: "Also save the graph here (.svg or .png)." } },
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: "nudg_compare",
    title: "Compare two versions",
    description: "Two versions of an interaction under the same events, for a person to judge. Says first whether anyone would notice the difference (imperceptible / subtle / clear, per property, with what changed: overshoot, settle time, position), then shows both: with `html`, real A/B filmstrips in two rows; otherwise both curves on one graph. If the change is below perception it proposes looking at an exaggerated version first.",
    inputSchema: {
      type: "object",
      properties: {
        a: { type: "object", description: "The current version: { file } or { source, path? }.", properties: source },
        b: { type: "object", description: "The changed version: { file } or { source, path? }.", properties: source },
        labels: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 2, description: "Names for the two versions, default [\"A\", \"B\"]." },
        html: { type: "string", description: "The host page with the component's markup. Gives real A/B filmstrips (needs Chrome) and writes a page the person should open: both versions playing side by side in a loop, with slow motion. Stills can't show feel; that page can. With html, a and b must both be files on disk (write the edited version first)." },
        page: { type: "string", description: "Where to write that page. Default: next to `out` as .html, else in the temp folder." },
        at: { type: "array", items: { type: ["number", "string"] }, description: "Frame times for the filmstrips." },
        frames: { type: "integer", minimum: 1, maximum: 60, description: "Evenly spaced frames when `at` is not given. Default 6." },
        ...timing,
        out: { type: "string", description: "Also save the picture here (.png; .svg for the graph)." },
      },
      required: ["a", "b"],
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: "nudg_render",
    title: "Render frames",
    description: "Draw real frames of the component as one filmstrip image, using the host page's markup and styles (elements with data-nudg names). Needs a local Chrome.",
    inputSchema: {
      type: "object",
      properties: {
        file: source.file,
        html: { type: "string", description: "Page with the component's markup and styles. Its scripts don't run." },
        events: timing.events,
        start: timing.start,
        reducedMotion: timing.reducedMotion,
        at: { type: "array", items: { type: ["number", "string"] }, description: "Frame times. Default: evenly spaced until at rest." },
        frames: { type: "integer", minimum: 1, maximum: 60, description: "Number of evenly spaced frames when `at` is not given. Default 6." },
        until: timing.until,
        out: { type: "string", description: "Also save the PNG here." },
      },
      required: ["file", "html"],
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: "nudg_observe",
    title: "Observe the real page",
    description: "Host truth. Opens the real page (its scripts run) in headless Chrome, performs actions on the element as a finger or a key would, measures it every frame (translate, scale, rotation, opacity, size, and whether it is still there), and says what the page actually showed. With `file`, judges the page against the file under the same actions: played as the file says, differs, never shown (the element left the page), or nothing moved. Needs a local Chrome.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "An http(s) URL of the running app, or a local .html path (served from the working directory)." },
        selector: { type: "string", description: "CSS selector of the element to measure; shadow roots are searched. Default, with `file`: [data-nudg=\"<the file's first target>\"]." },
        actions: {
          type: "array",
          description: `What to do, in time order: { "action": "tap", "t": 0.1 }. Actions are ${ACTIONS}. The page's own handlers run, so a click that navigates away will.`,
          items: { type: "object", properties: { action: { type: "string" }, t: { type: ["number", "string"] } }, required: ["action", "t"] },
          minItems: 1,
        },
        file: source.file,
        on: { type: "string", description: "Which of the file's targets the actions are for. Default: the first target that handles them (a toggle's track, not its knob)." },
        events: { ...timing.events, description: "The file's events to judge against. Default: the actions, as the file's events on `on`, at the times they actually happened." },
        start: timing.start,
        reducedMotion: timing.reducedMotion,
        settle: { type: ["number", "string"], description: "Seconds to keep measuring after the last action. Default 1.5." },
        warmup: { type: ["number", "string"], description: "Seconds to let the page's scripts start first. Default 0.5." },
        viewport: { type: "object", properties: { width: { type: "integer" }, height: { type: "integer" } }, description: "Window size, e.g. a phone's 390×844." },
      },
      required: ["url", "actions"],
    },
    annotations: { readOnlyHint: true },
  },
];

export function serveMcp(input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout): Promise<void> {
  const write = (message: Json) => output.write(JSON.stringify(message) + "\n");
  const lines = createInterface({ input, crlfDelay: Infinity });
  const inflight = new Set<Promise<void>>();

  lines.on("line", (line) => {
    if (!line.trim()) return;
    let message: Json;
    try {
      message = JSON.parse(line);
    } catch {
      write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }
    const task = handle(message)
      .then((response) => {
        if (response) write(response);
      })
      .finally(() => inflight.delete(task));
    inflight.add(task);
  });

  return new Promise((resolveDone) => lines.on("close", () => Promise.all(inflight).then(() => resolveDone())));
}

async function handle(message: Json): Promise<Json | undefined> {
  const { id, method, params } = message as { id?: string | number; method?: string; params?: Json };
  const isRequest = id !== undefined && id !== null;
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id, result });
  const error = (code: number, text: string) => ({ jsonrpc: "2.0", id, error: { code, message: text } });

  if (typeof method !== "string") return isRequest ? error(-32600, "Invalid request") : undefined;
  if (!isRequest) return undefined; // notifications/initialized, cancellations: nothing to do

  switch (method) {
    case "initialize": {
      const requested = (params?.protocolVersion as string) ?? PROTOCOL_VERSIONS[0];
      return reply({
        protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "nudg", title: "nudg", version: VERSION },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: TOOLS });
    case "tools/call": {
      const name = params?.name as string;
      if (!TOOLS.some((t) => t.name === name)) return error(-32602, `Unknown tool: ${name}`);
      return reply(await callTool(name, (params?.arguments as Json) ?? {}));
    }
    default:
      return error(-32601, `Method not found: ${method}`);
  }
}

async function callTool(name: string, args: Json): Promise<ToolResult> {
  try {
    switch (name) {
      case "nudg_guide":
        return { content: [text(readFileSync(GUIDE, "utf8"))] };
      case "nudg_validate":
        return validateTool(args);
      case "nudg_simulate":
        return simulateTool(args);
      case "nudg_plot":
        return await plotTool(args);
      case "nudg_render":
        return await renderTool(args);
      case "nudg_compare":
        return await compareTool(args);
      case "nudg_observe":
        return await observeTool(args);
    }
    throw new ToolError(`Unknown tool: ${name}`);
  } catch (e) {
    return { content: [text(e instanceof ToolError ? e.message : `nudg failed: ${(e as Error).message}`)], isError: true };
  }
}

function validateTool(args: Json): ToolResult {
  const { label, result } = load(args);
  const ok = !result.diagnostics.some((d) => d.severity === "error");
  const lines = [`${label}: ${formatStatus(result.diagnostics)}`, ...result.diagnostics.map(formatDiagnostic)];
  return { content: [text(lines.join("\n"))], structuredContent: { ok, diagnostics: result.diagnostics } };
}

function simulateTool(args: Json): ToolResult {
  const { program, label } = loadProgram(args);
  const options = { ...timingOptions(args, program), every: optionalTime(args.every, "every") };
  const sim = simulate(program, options);
  const keys = options.properties ?? [...program.properties.keys()];
  const body = `${label}\n\nsummary\n${formatSummary(sim, keys)}\n\n${formatSamples(sim, keys)}`;
  return { content: [text(body)], structuredContent: { summary: sim.summary, unhandled: sim.unhandled, samples: sim.samples } };
}

async function plotTool(args: Json): Promise<ToolResult> {
  const { program, label } = loadProgram(args);
  const options = timingOptions(args, program);
  const result = plot(program, { ...options, title: label });
  const keys = options.properties ?? [...program.properties.keys()];
  const summary = `${label}\n${formatSummary(result.simulation, keys)}`;
  const out = optionalString(args.out, "out");
  const chrome = findChrome();

  if (out && extname(out).toLowerCase() === ".svg") writeFileSync(out, result.svg + "\n");
  if (!chrome) {
    if (out && extname(out).toLowerCase() === ".png") throw new ToolError(`Saving a PNG needs a browser. ${CHROME_HINT}`);
    return {
      content: [text(`${summary}\n\n(No Chrome found, so here is the SVG source. ${CHROME_HINT})\n\n${result.svg}`)],
      structuredContent: { summary: result.simulation.summary, unhandled: result.simulation.unhandled },
    };
  }
  const png = withTempFile("plot.png", (path) => {
    svgToPng(result.svg, result.width, result.height, path, chrome);
    return readFileSync(path);
  });
  if (out && extname(out).toLowerCase() === ".png") writeFileSync(out, png);
  return {
    content: [text(summary + (out ? `\nsaved ${out}` : "")), { type: "image", data: png.toString("base64"), mimeType: "image/png" }],
    structuredContent: { summary: result.simulation.summary, unhandled: result.simulation.unhandled },
  };
}

async function compareTool(args: Json): Promise<ToolResult> {
  if (typeof args.a !== "object" || args.a === null || typeof args.b !== "object" || args.b === null) throw new ToolError("`a` and `b` are required: { file } or { source }.");
  const a = loadProgram(args.a as Json);
  const b = loadProgram(args.b as Json);
  const labels = (Array.isArray(args.labels) && args.labels.length === 2 ? args.labels.map(String) : ["A", "B"]) as [string, string];
  const options = timingOptions(args, a.program);
  const comparison = compare(a.program, b.program, options);
  const text0 = `${labels[0]}: ${a.label}  ${labels[1]}: ${b.label}\n\n${formatComparison(comparison, labels)}`;
  const { a: _a, b: _b, ...structured } = comparison;
  const out = optionalString(args.out, "out");
  const chrome = findChrome();
  const html = optionalString(args.html, "html");

  if (html) {
    if (!chrome) throw new ToolError(`Filmstrips need a browser. ${CHROME_HINT} Drop html for a graph.`);
    const fileA = typeof (args.a as Json).file === "string" ? ((args.a as Json).file as string) : undefined;
    const fileB = typeof (args.b as Json).file === "string" ? ((args.b as Json).file as string) : undefined;
    if (!fileA || !fileB) throw new ToolError("With html, pass both versions as files (the harness loads them from disk).");
    const at = Array.isArray(args.at) ? args.at.map((t, i) => time(t, `at[${i}]`)) : [];
    const frames = args.frames === undefined ? 6 : Number(args.frames);
    const chosen = at.length ? { times: [...at].sort((x, y) => x - y), marks: {} } : compareFrameTimes(comparison, frames);
    const { png } = await withTempFileAsync("compare.png", async (path) => {
      await renderFrames({ file: resolve(fileA), label: labels[0], variants: [{ file: resolve(fileB), label: labels[1] }], html: resolve(html), events: options.events, start: options.start, reducedMotion: options.reducedMotion, times: chosen.times, marks: chosen.marks, out: path, chrome });
      return { png: readFileSync(path) };
    });
    if (out) writeFileSync(out, png);
    // The page goes next to --out when there is one, else into the temp folder: never into the project unasked.
    const pagePath = resolve(optionalString(args.page, "page") ?? (out ? out.replace(/\.[^.]*$/, "") + ".html" : join(tmpdir(), "nudg-compare.html")));
    const untilBoth2 = Math.max(comparison.a.samples.at(-1)!.t, comparison.b.samples.at(-1)!.t);
    writeFileSync(pagePath, comparePage({ html: readFileSync(resolve(html), "utf8"), a: readWithImports(fileA), b: readWithImports(fileB), labels, events: options.events, until: untilBoth2, start: options.start, reducedMotion: options.reducedMotion, headline: comparison.headline }));
    const openIt = `${lastRuntimeInlined ? "" : "\n\n(The runtime isn't built here, so the page loads @nudg/core from unpkg; run npm run build for an offline page.)"}\n\nFor the person: open ${pagePath} in a browser. Both versions play side by side in a loop, with ¼× and ⅒× slow motion and live values; stills can't show feel, that page can. Tell them to open it and judge there.`;
    return { content: [text(text0 + (out ? `\nsaved ${out}` : "") + openIt), { type: "image", data: png.toString("base64"), mimeType: "image/png" }], structuredContent: { ...(structured as unknown as Json), page: pagePath } };
  }

  const graph = plot(a.program, { ...options, against: b.program, labels, title: `${a.label} vs ${b.label}` });
  if (out && extname(out).toLowerCase() === ".svg") writeFileSync(out, graph.svg + "\n");
  if (!chrome) {
    return { content: [text(`${text0}\n\n(No Chrome found, so here is the SVG graph. ${CHROME_HINT})\n\n${graph.svg}`)], structuredContent: structured as unknown as Json };
  }
  const png = withTempFile("compare.png", (path) => {
    svgToPng(graph.svg, graph.width, graph.height, path, chrome);
    return readFileSync(path);
  });
  if (out && extname(out).toLowerCase() === ".png") writeFileSync(out, png);
  return { content: [text(text0 + (out ? `\nsaved ${out}` : "")), { type: "image", data: png.toString("base64"), mimeType: "image/png" }], structuredContent: structured as unknown as Json };
}

async function observeTool(args: Json): Promise<ToolResult> {
  const url = requiredString(args.url, "url");
  const chrome = findChrome();
  if (!chrome) throw new ToolError(`nudg_observe needs a browser. ${CHROME_HINT}`);
  const program = args.file !== undefined || args.source !== undefined ? loadProgram(args).program : undefined;
  const target = program ? [...program.properties.keys()][0]?.split(".")[0] : undefined;
  const selector = optionalString(args.selector, "selector") ?? (target ? `[data-nudg="${target}"]` : undefined);
  if (!selector) throw new ToolError("Pass `selector` (or `file`, whose first target names the element).");
  if (!Array.isArray(args.actions) || args.actions.length === 0) throw new ToolError(`\`actions\` must list at least one { action, t }. Actions are ${ACTIONS}.`);
  const actions: HostAction[] = args.actions.map((a, i) => {
    const item = (typeof a === "object" && a !== null ? a : {}) as Json;
    const action = requiredString(item.action, `actions[${i}].action`);
    const problem = checkAction(action);
    if (problem) throw new ToolError(problem);
    return { action, t: time(item.t, `actions[${i}].t`) };
  });
  const viewport = typeof args.viewport === "object" && args.viewport !== null ? (args.viewport as { width: number; height: number }) : undefined;
  const observation = await observe({ url, selector, actions, chrome, settle: optionalTime(args.settle, "settle"), warmup: optionalTime(args.warmup, "warmup"), viewport });
  let judgement;
  let fileSummary;
  if (program) {
    const options = timingOptions(args, program);
    const on = optionalString(args.on, "on");
    if (on && !program.targets.includes(on)) throw new ToolError(`on: the file has no target "${on}" (it has ${program.targets.join(", ")}).`);
    if (options.events.length === 0) options.events = actionsToEvents((action) => on ?? actionTarget(program, action), observation.series.marks);
    const last = observation.series.samples.at(-1)?.t ?? 0;
    const sim = simulate(program, { ...options, until: options.until ?? Math.max(last, options.events.at(-1)?.t ?? 0) });
    judgement = judgeHost(sim, observation.summary, { target });
    fileSummary = sim.summary;
  }
  const view = { url, selector, summary: observation.summary, marks: observation.series.marks, errors: observation.errors };
  return {
    content: [text(formatObservation(view, judgement))],
    structuredContent: { ok: true, url, selector, marks: observation.series.marks, summary: observation.summary, errors: observation.errors, judgement: judgement as unknown as Json, file: fileSummary as unknown as Json } as Json,
  };
}

async function renderTool(args: Json): Promise<ToolResult> {
  const file = requiredString(args.file, "file");
  const html = requiredString(args.html, "html");
  const { program, label } = loadProgram({ file });
  const chrome = findChrome();
  if (!chrome) throw new ToolError(`nudg_render needs a browser. ${CHROME_HINT} nudg_plot works without one.`);
  const options = timingOptions(args, program);
  const at = Array.isArray(args.at) ? args.at.map((t, i) => time(t, `at[${i}]`)) : [];
  const frames = args.frames === undefined ? 6 : Number(args.frames);
  if (!Number.isInteger(frames) || frames < 1 || frames > 60) throw new ToolError("`frames` must be a whole number from 1 to 60.");
  const times = at.length ? [...at].sort((a, b) => a - b) : frameTimes(program, options, frames);
  const out = optionalString(args.out, "out");

  const { result, png } = await withTempFileAsync("frames.png", async (path) => {
    const result = await renderFrames({ file: resolve(file), html: resolve(html), events: options.events, start: options.start, reducedMotion: options.reducedMotion, times, out: path, chrome });
    return { result, png: readFileSync(path) };
  });
  if (out) writeFileSync(out, png);
  const lines = [label, ...result.frames.map((f) => `  ${f.t.toFixed(3)}s  ${f.state.join("  ")}`)];
  if (result.unbound.length) lines.push(`no element for: ${result.unbound.join(", ")} (add data-nudg="${result.unbound[0]}" to the page)`);
  if (result.unknown.length) lines.push(`not targets in the file: ${result.unknown.join(", ")}`);
  if (out) lines.push(`saved ${out}`);
  return {
    content: [text(lines.join("\n")), { type: "image", data: png.toString("base64"), mimeType: "image/png" }],
    structuredContent: { frames: result.frames, unbound: result.unbound, unknown: result.unknown },
  };
}

function load(args: Json): { label: string; result: CompileResult } {
  if (typeof args.source === "string") {
    const path = resolve(typeof args.path === "string" ? args.path : "inline.nudg.json");
    return { label: typeof args.path === "string" ? args.path : "(source)", result: compile({ path, text: args.source }, readOptional) };
  }
  const file = requiredString(args.file, "file");
  if (readOptional(resolve(file)) === undefined) throw new ToolError(`File not found: ${file} (working directory: ${process.cwd()}).`);
  return { label: file, result: compilePath(resolve(file)) };
}

function loadProgram(args: Json): { label: string; program: Program } {
  const { label, result } = load(args);
  if (!result.program) {
    throw new ToolError([`${label} has errors, so it can't run yet. Fix these, then try again:`, ...result.diagnostics.map(formatDiagnostic)].join("\n"));
  }
  return { label, program: result.program };
}

function timingOptions(args: Json, program: Program): SimulateOptions {
  const raw = args.events ?? [];
  if (!Array.isArray(raw)) throw new ToolError("`events` must be an array of { event, t }.");
  const events: TimedEvent[] = raw.flatMap((e, i): TimedEvent[] => {
    const item = (typeof e === "object" && e !== null ? e : {}) as Json;
    const t = () => time(item.t, `events[${i}].t`);
    if (typeof item.event === "string") return [{ event: item.event, t: t() }];
    if (typeof item.input === "string") {
      if (typeof item.value !== "number") throw new ToolError(`events[${i}] needs a numeric "value" with "input".`);
      return [{ input: item.input, value: item.value, t: t() }];
    }
    if (typeof item.drag === "string") {
      const from = t();
      const to = time(item.until, `events[${i}].until`);
      if (!(to > from)) throw new ToolError(`events[${i}]: "until" must be after "t".`);
      const dx = typeof item.dx === "number" ? item.dx : 0;
      const dy = typeof item.dy === "number" ? item.dy : 0;
      return dragGesture(item.drag, from, to, dx, dy);
    }
    throw new ToolError(`events[${i}] must have "event", "input" or "drag", e.g. { "event": "track.tap", "t": 0.1 }.`);
  });
  let start: string[] | undefined;
  if (args.start !== undefined) {
    if (!Array.isArray(args.start) || args.start.some((p) => typeof p !== "string")) throw new ToolError("`start` must be an array of state paths.");
    start = args.start as string[];
  }
  let properties: string[] | undefined;
  if (args.properties !== undefined) {
    if (!Array.isArray(args.properties) || args.properties.some((p) => typeof p !== "string")) throw new ToolError("`properties` must be an array of names.");
    properties = args.properties as string[];
    const unknown = properties.filter((p) => !program.properties.has(p));
    if (unknown.length) throw new ToolError(`Unknown properties: ${unknown.join(", ")}. This file has ${[...program.properties.keys()].join(", ")}.`);
  }
  const reducedMotion = args.reducedMotion === undefined ? undefined : Boolean(args.reducedMotion);
  return { events, start, reducedMotion, until: optionalTime(args.until, "until"), properties };
}

function time(raw: unknown, what: string): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) return raw;
  const m = typeof raw === "string" ? /^(\d+\.?\d*|\.\d+)(ms|s)?$/.exec(raw) : null;
  if (!m) throw new ToolError(`${what} must be seconds (0.1) or a string like "100ms".`);
  return m[2] === "ms" ? Number(m[1]) / 1000 : Number(m[1]);
}

function optionalTime(raw: unknown, what: string): number | undefined {
  return raw === undefined ? undefined : time(raw, what);
}

function requiredString(raw: unknown, what: string): string {
  if (typeof raw !== "string" || !raw) throw new ToolError(`\`${what}\` is required.`);
  return raw;
}

function optionalString(raw: unknown, what: string): string | undefined {
  if (raw === undefined) return undefined;
  return requiredString(raw, what);
}

function text(value: string): Content {
  return { type: "text", text: value };
}

function readOptional(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

function withTempFile<T>(name: string, fn: (path: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "nudg-mcp-"));
  try {
    return fn(join(dir, name));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function withTempFileAsync<T>(name: string, fn: (path: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "nudg-mcp-"));
  try {
    return await fn(join(dir, name));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
