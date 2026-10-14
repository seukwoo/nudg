// Renders real frames of a component: the host's own markup and styles, played by the
// DOM adapter on a manual clock, captured by headless Chrome as one filmstrip PNG.

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import * as nodeModule from "node:module";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { simulate, type SimulateOptions, type TimedEvent } from "../core/simulate.ts";
import type { Program } from "../core/types.ts";
import { launchBrowser, waitFor } from "./cdp.ts";

export interface RenderOptions {
  /** The nudg file. */
  file: string;
  /** A page with the component's markup (data-nudg names) and styles. Its scripts don't run. */
  html: string;
  events: TimedEvent[];
  /** Leaf state paths to start in, instead of `initial`. */
  start?: string[];
  /** Reduced motion (v0.3). */
  reducedMotion?: boolean;
  /** One frame per time, in seconds. */
  times: number[];
  out: string;
  chrome: string;
  /** Device pixel ratio. Default 2. */
  scale?: number;
}

export interface RenderedFrame {
  t: number;
  state: string[];
}

export interface RenderResult {
  out: string;
  frames: RenderedFrame[];
  /** Targets with no element in the page, and data-nudg names the file doesn't declare. */
  unbound: string[];
  unknown: string[];
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".ts": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

// The adapter is served from wherever this module runs: TypeScript sources (types
// stripped on the fly, no build step) or the compiled dist.
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = import.meta.url.endsWith(".ts") ? ".ts" : ".js";

/** Evenly spaced frame times from 0 until everything is at rest (or `options.until`). */
export function frameTimes(program: Program, options: SimulateOptions, frames = 6): number[] {
  const samples = simulate(program, { ...options, every: 0.01 }).samples;
  const until = options.until ?? samples[samples.length - 1].t;
  if (frames === 1) return [until];
  return Array.from({ length: frames }, (_, i) => Number(((until * i) / (frames - 1)).toFixed(3)));
}

export async function renderFrames(options: RenderOptions): Promise<RenderResult> {
  const file = resolve(options.file);
  const html = resolve(options.html);
  // Only these folders are served, read-only, on 127.0.0.1, for the length of the render.
  const roots = [...new Set([process.cwd(), dirname(file), dirname(html)])];
  const harness = buildHarness(readFileSync(html, "utf8"), html, file, options.events, options.times, options.start, options.reducedMotion);

  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
    const send = (status: number, body: string | Buffer, type = "text/plain; charset=utf-8") => {
      res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
      res.end(body);
    };
    if (path === "/harness.html") return send(200, harness, TYPES[".html"]);
    if (path.startsWith("/__nudg/")) {
      const target = resolve(SRC, path.slice("/__nudg/".length));
      if (!target.startsWith(SRC + sep) || !isFile(target)) return send(404, "not found");
      const code = readFileSync(target, "utf8");
      return send(200, target.endsWith(".ts") ? stripTypes(code) : code, TYPES[".js"]);
    }
    if (path.startsWith("/fs/")) {
      const target = resolve("/", path.slice("/fs/".length));
      if (!roots.some((root) => target.startsWith(root + sep)) || !isFile(target)) return send(404, "not found");
      return send(200, readFileSync(target), TYPES[extname(target).toLowerCase()] ?? "application/octet-stream");
    }
    send(404, "not found");
  });
  const port = await listen(server);

  const browser = await launchBrowser(options.chrome);
  try {
    await browser.send("Page.enable");
    await browser.send("Page.navigate", { url: `http://127.0.0.1:${port}/harness.html` });
    const report = await waitFor(() => browser.evaluate("window.__nudg"), 20_000);
    if (!report.ok) throw new Error(report.error);

    const scale = options.scale ?? 2;
    const { width, height } = await browser.evaluate(
      `(() => { const r = document.querySelector(".nudg-strip").getBoundingClientRect(); return { width: Math.ceil(r.width), height: Math.ceil(r.height) }; })()`,
    );
    await browser.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false });
    const shot = await browser.send("Page.captureScreenshot", {
      format: "png",
      clip: { x: 0, y: 0, width, height, scale: 1 },
      captureBeyondViewport: true,
    });
    writeFileSync(options.out, Buffer.from(shot.data, "base64"));
    return { out: options.out, frames: report.frames, unbound: report.unbound, unknown: report.unknown };
  } finally {
    await browser.close();
    server.close();
  }
}

function buildHarness(page: string, htmlPath: string, nudgPath: string, events: TimedEvent[], times: number[], start?: string[], reducedMotion?: boolean): string {
  const head = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(page)?.[1] ?? "";
  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(page);
  const body = bodyMatch ? bodyMatch[1] : head ? "" : page;
  const noScripts = (s: string) => s.replace(/<script[\s\S]*?<\/script>/gi, "");
  const frames = times
    .map((t) => `<figure class="nudg-frame" data-t="${t}"><div class="nudg-stage">${noScripts(body)}</div><figcaption>${fmt(t)}s</figcaption></figure>`)
    .join("\n");
  const sorted = [...events].sort((a, b) => a.t - b.t);

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<base href="/fs${encodePath(dirname(htmlPath))}/">
${noScripts(head)}
<style>
  html, body { margin: 0 !important; padding: 0 !important; min-height: 0 !important; width: max-content !important; }
  .nudg-strip { display: inline-flex; gap: 8px; padding: 8px; background: #fcfcfb; }
  .nudg-frame { margin: 0; display: flex; flex-direction: column; align-items: stretch; gap: 4px; }
  .nudg-stage { position: relative; }
  .nudg-frame figcaption { font: 12px/1.4 ui-monospace, "SF Mono", Menlo, monospace; color: #52514e; text-align: center; }
</style>
</head>
<body>
<div class="nudg-strip">
${frames}
</div>
<script type="module">
  try {
    const { compileUrl, play } = await import("/__nudg/dom/index${EXT}");
    const events = ${JSON.stringify(sorted)};
    const start = ${JSON.stringify(start ?? null)};
    const reducedMotion = ${JSON.stringify(reducedMotion ?? false)};
    const { program, diagnostics } = await compileUrl(${JSON.stringify(`/fs${encodePath(nudgPath)}`)});
    if (!program) throw new Error("The file has errors: " + diagnostics.map((d) => d.code + " at " + d.path).join(", "));
    const frames = [];
    let player;
    for (const frame of document.querySelectorAll(".nudg-frame")) {
      const t = Number(frame.dataset.t);
      player = play(program, frame.querySelector(".nudg-stage"), { clock: "manual", state: start ?? undefined, reducedMotion });
      for (const e of events) {
        if (e.t > t) break;
        player.render(e.t);
        if ("event" in e) player.send(e.event);
        else player.input(e.input, e.value);
      }
      player.render(t);
      frames.push({ t, state: player.runtime.state() });
    }
    await document.fonts.ready;
    await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
    window.__nudg = { ok: true, frames, unbound: player?.unbound ?? [], unknown: player?.unknown ?? [] };
  } catch (e) {
    window.__nudg = { ok: false, error: String(e?.message ?? e) };
  }
</script>
</body>
</html>`;
}

let warned = false;

function stripTypes(source: string): string {
  const strip = (nodeModule as { stripTypeScriptTypes?: (code: string) => string }).stripTypeScriptTypes;
  if (!strip) throw new Error("This Node has no stripTypeScriptTypes; use Node 23.2 or later, or run from the built dist.");
  if (!warned) {
    // The API is marked experimental; its one-time warning is noise for CLI users.
    warned = true;
    const emit = process.emitWarning;
    process.emitWarning = (() => {}) as typeof process.emitWarning;
    try {
      return strip(source);
    } finally {
      process.emitWarning = emit;
    }
  }
  return strip(source);
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port));
  });
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

function encodePath(path: string): string {
  return path.split(sep).map(encodeURIComponent).join("/");
}

function fmt(t: number): string {
  return String(Number(t.toFixed(3)));
}

