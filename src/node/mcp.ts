// MCP server over stdio: newline-delimited JSON-RPC 2.0. Exposes the same capabilities
// as the CLI as tools, so an agent can write, check, and look at interactions.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { compile, type CompileResult } from "../core/compile.ts";
import { plot } from "../core/plot.ts";
import { dragGesture, simulate, type SimulateOptions, type TimedEvent } from "../core/simulate.ts";
import type { Program } from "../core/types.ts";
import { VERSION } from "../core/vocabulary.ts";
import { CHROME_HINT, findChrome, svgToPng } from "./chrome.ts";
import { formatDiagnostic, formatSamples, formatStatus, formatSummary } from "./format.ts";
import { compilePath } from "./load.ts";
import { frameTimes, renderFrames } from "./render.ts";

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const GUIDE = resolve(dirname(fileURLToPath(import.meta.url)), "../../spec/guide.md");

const INSTRUCTIONS = `nudg files (*.nudg.json) describe UI interactions: states, events, and spring or tween motion.
If you haven't written one before, call nudg_guide first. After any edit, call nudg_validate and apply its hints until it reports no errors. To check behavior, use nudg_simulate (numbers) or nudg_plot (a graph image); use nudg_render when the host page's HTML is available.`;

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
