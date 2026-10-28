// A page a person opens to judge a change: both versions side by side, on the host's
// own markup, replaying the same events in a loop, with slow motion. Stills can't show
// feel; this moves. Self-contained apart from the nudg runtime, which it loads from
// unpkg at this exact version so the file works from anywhere.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { TimedEvent } from "../core/simulate.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * The runtime, inlined: every built module as a data: URL in an import map, with the
 * modules' relative imports rewritten to bare "nudg:/" specifiers the map resolves. The
 * page then works offline, from any folder, with the exact runtime that judged it. From
 * a clone without a build, it falls back to unpkg at the package version.
 */
/** Whether the last page inlined the runtime, or had to point at unpkg (a clone without a build). */
export let lastRuntimeInlined = true;

function runtimeImportMap(): Record<string, string> {
  const dist = join(ROOT, "dist");
  const files = new Map<string, string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js")) files.set(relative(dist, full).split(sep).join("/"), readFileSync(full, "utf8"));
    }
  };
  if (existsSync(join(dist, "dom", "index.js"))) walk(dist);
  const needed = new Set<string>();
  const queue = ["dom/index.js"];
  while (queue.length) {
    const path = queue.pop()!;
    if (needed.has(path) || !files.has(path)) continue;
    needed.add(path);
    for (const m of files.get(path)!.matchAll(/from\s+"(\.{1,2}\/[^"]+)"/g)) queue.push(resolveRelative(path, m[1]));
  }
  if (!needed.has("dom/index.js")) {
    let version = "latest";
    try {
      version = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
    } catch {
      // unpkg's "latest" is fine.
    }
    lastRuntimeInlined = false;
    return { "@nudg/core/dom": `https://unpkg.com/@nudg/core@${version}/dist/dom/index.js` };
  }
  lastRuntimeInlined = true;
  const map: Record<string, string> = {};
  for (const path of needed) {
    const code = files.get(path)!.replace(/from\s+"(\.{1,2}\/[^"]+)"/g, (_, spec: string) => `from "nudg:/${resolveRelative(path, spec)}"`);
    map[`nudg:/${path}`] = `data:text/javascript;base64,${Buffer.from(code, "utf8").toString("base64")}`;
  }
  map["@nudg/core/dom"] = map["nudg:/dom/index.js"];
  return map;
}

function resolveRelative(from: string, spec: string): string {
  const parts = from.split("/").slice(0, -1);
  for (const seg of spec.split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

export interface ComparePageOptions {
  /** The host page with the component's markup and styles. */
  html: string;
  /** The two nudg documents as JSON text, and the files they import (normalized paths). */
  a: { text: string; files: Record<string, string> };
  b: { text: string; files: Record<string, string> };
  labels: [string, string];
  events: TimedEvent[];
  /** Seconds to play before looping; usually when both have settled. */
  until: number;
  start?: string[];
  reducedMotion?: boolean;
  /** The verdict, shown above the stages. */
  headline: string;
}

/** Reads a nudg file and everything it imports, keyed the way the compiler asks. */
export function readWithImports(file: string): { text: string; files: Record<string, string> } {
  const path = resolve(file);
  const text = readFileSync(path, "utf8");
  const files: Record<string, string> = {};
  const visit = (from: string, t: string) => {
    let doc: { import?: unknown };
    try {
      doc = JSON.parse(t);
    } catch {
      return;
    }
    for (const spec of Array.isArray(doc.import) ? doc.import : []) {
      if (typeof spec !== "string") continue;
      const abs = resolve(dirname(from), spec);
      // Keyed the way the page's compiler asks for it: relative to the root file, through nested imports.
      const key = relative(dirname(path), abs).split(sep).join("/");
      if (key in files) continue;
      try {
        files[key] = readFileSync(abs, "utf8");
        visit(abs, files[key]);
      } catch {
        // The compiler will report the missing import.
      }
    }
  };
  visit(path, text);
  return { text, files };
}

export function comparePage(o: ComparePageOptions): string {
  const page = o.html;
  const head = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(page)?.[1] ?? "";
  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(page);
  const body = bodyMatch ? bodyMatch[1] : head ? "" : page;
  const noScripts = (s: string) => s.replace(/<script[\s\S]*?<\/script>/gi, "");
  const importMap = runtimeImportMap();
  const events = [...o.events].sort((x, y) => x.t - y.t);
  const pressTarget = firstTarget(o.a.text);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.labels[0])} vs ${esc(o.labels[1])} · nudg compare</title>
${noScripts(head)}
<style>
  body { margin: 0; background: #f6f6f4; color: #1c1c1a; font: 15px/1.5 ui-sans-serif, system-ui, sans-serif; }
  .nudg-compare { max-width: 960px; margin: 0 auto; padding: 24px 16px 48px; }
  .nudg-compare h1 { margin: 0 0 4px; font-size: 18px; }
  .nudg-compare .verdict { margin: 0 0 16px; color: #52514e; }
  .nudg-stages { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .nudg-stage-card { background: #fff; border: 1px solid #e4e4df; border-radius: 12px; padding: 12px; }
  .nudg-stage-card h2 { margin: 0 0 8px; font-size: 14px; }
  .nudg-stage { position: relative; display: grid; place-items: center; min-height: 160px; padding: 12px; background: #f6f6f4; border-radius: 8px; }
  .nudg-stage > * { max-width: 100%; }
  .nudg-controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 16px 0 8px; }
  .nudg-controls button { font: 13px ui-sans-serif, system-ui, sans-serif; padding: 6px 12px; border: 1px solid #e4e4df; border-radius: 8px; background: #fff; cursor: pointer; }
  .nudg-controls button[aria-pressed="true"] { background: #1c1c1a; color: #fff; border-color: #1c1c1a; }
  .nudg-time { font: 12px ui-monospace, "SF Mono", Menlo, monospace; color: #52514e; min-width: 6ch; }
  .nudg-bar { position: relative; height: 4px; background: #e4e4df; border-radius: 2px; margin-top: 8px; overflow: hidden; }
  .nudg-bar i { position: absolute; left: 0; top: 0; bottom: 0; width: 0; background: #2a78d6; }
  .nudg-note { font-size: 13px; color: #52514e; }
  .nudg-values { margin-top: 8px; font: 12px ui-monospace, "SF Mono", Menlo, monospace; color: #52514e; font-variant-numeric: tabular-nums; white-space: pre-wrap; }
  @media (max-width: 640px) { .nudg-stages { grid-template-columns: 1fr; } }
</style>
<script type="importmap">${js({ imports: importMap })}</script>
</head>
<body>
<div class="nudg-compare">
  <h1>${esc(o.labels[0])} vs ${esc(o.labels[1])}</h1>
  <p class="verdict">${esc(o.headline)}</p>
  <div class="nudg-stages">
    <div class="nudg-stage-card"><h2>${esc(o.labels[0])}</h2><div class="nudg-stage" id="stage-a">${noScripts(body)}</div><div class="nudg-values" id="values-a"></div></div>
    <div class="nudg-stage-card"><h2>${esc(o.labels[1])}</h2><div class="nudg-stage" id="stage-b">${noScripts(body)}</div><div class="nudg-values" id="values-b"></div></div>
  </div>
  <div class="nudg-controls">
    <button type="button" id="replay">Replay the events</button>
    ${pressTarget ? `<button type="button" id="press-both">Press both</button>
    <span class="nudg-note">hold</span>
    <button type="button" data-hold="0.3" aria-pressed="true">0.3s</button>
    <button type="button" data-hold="1" aria-pressed="false">1s</button>` : ""}
  </div>
  <div class="nudg-controls">
    <span class="nudg-note">Speed</span>
    <button type="button" data-speed="1" aria-pressed="true">1×</button>
    <button type="button" data-speed="0.25" aria-pressed="false">¼×</button>
    <button type="button" data-speed="0.1" aria-pressed="false">⅒×</button>
    <button type="button" id="pause" aria-pressed="false">Pause</button>
    <span class="nudg-time" id="time">0.00s</span>
  </div>
  <div class="nudg-bar"><i id="bar"></i></div>
  <p class="nudg-note">Both play the same events (${esc(describeEvents(events))}) and loop. Slow it down to see the difference. A tap or drag on either stage happens on both.</p>
</div>
<script type="module">
  const { playDoc } = await import("@nudg/core/dom");
  const A = ${js(o.a)};
  const B = ${js(o.b)};
  const events = ${js(events)};
  const until = ${js(o.until)};
  const start = ${js(o.start ?? null)};
  const reducedMotion = ${js(o.reducedMotion ?? false)};
  const pressTarget = ${js(pressTarget)};
  let speed = 1, paused = false, t = 0, last = 0, next = 0, players = [], raf = 0, script = events, hold = 0.3, loopUntil = until;
  const timeEl = document.getElementById("time"), bar = document.getElementById("bar");
  const valueEls = [document.getElementById("values-a"), document.getElementById("values-b")];

  function mount(withScript) {
    script = withScript; loopUntil = withScript === events ? until : hold + 1.2;
    for (const p of players) p.destroy();
    players = [["stage-a", A], ["stage-b", B]].map(([id, v], i) => {
      // What a person does on one stage happens on the other too (onEvent reports only what came from the page, so nothing echoes).
      const onEvent = (item) => {
        const other = players[1 - i];
        if (!other) return;
        if ("event" in item) other.send(item.event);
        else other.input(item.input, item.value);
      };
      try {
        return playDoc(JSON.parse(v.text), document.getElementById(id), { clock: "manual", files: v.files, state: start ?? undefined, reducedMotion, onEvent });
      } catch (e) {
        document.getElementById(id).innerHTML = '<pre style="white-space:pre-wrap;font:12px ui-monospace,Menlo,monospace;color:#b91c1c;margin:0">' + String(e.message).replace(/</g, "&lt;") + "</pre>";
        return { render() {}, send() {}, input() {}, values: () => ({}), destroy() {} };
      }
    });
    t = 0; next = 0; last = performance.now();
    for (const p of players) p.render(0);
  }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (paused) { last = now; return; }
    // rAF timestamps can trail performance.now() from mount(); never step backwards.
    t += (Math.max(0, now - last) / 1000) * speed; last = now;
    while (next < script.length && script[next].t <= t) {
      const e = script[next++];
      for (const p of players) { p.render(e.t); if ("event" in e) p.send(e.event); else p.input(e.input, e.value); }
    }
    players.forEach((p, i) => {
      p.render(t);
      const v = p.values();
      valueEls[i].textContent = Object.entries(v).map(([k, x]) => k + " " + (typeof x === "number" ? x.toFixed(2) : x)).join("\\n");
    });
    timeEl.textContent = t.toFixed(2) + "s";
    bar.style.width = Math.min(100, (t / loopUntil) * 100) + "%";
    if (t >= loopUntil + 0.6) mount(script);
  }
  document.getElementById("replay").onclick = () => mount(events);
  if (pressTarget) {
    // A press on both stages at once: down, then up (a tap) after the hold.
    document.getElementById("press-both").onclick = () => mount([{ t: 0.1, event: pressTarget + ".down" }, { t: 0.1 + hold, event: pressTarget + ".up" }, { t: 0.1 + hold, event: pressTarget + ".tap" }]);
    for (const b of document.querySelectorAll("[data-hold]")) b.onclick = () => {
      hold = Number(b.dataset.hold);
      for (const o of document.querySelectorAll("[data-hold]")) o.setAttribute("aria-pressed", String(o === b));
    };
  }
  document.getElementById("pause").onclick = (e) => { paused = !paused; e.currentTarget.setAttribute("aria-pressed", String(paused)); };
  for (const b of document.querySelectorAll("[data-speed]")) b.onclick = () => {
    speed = Number(b.dataset.speed);
    for (const o of document.querySelectorAll("[data-speed]")) o.setAttribute("aria-pressed", String(o === b));
  };
  mount(events);
  raf = requestAnimationFrame(frame);
</script>
</body>
</html>`;
}

/** JSON for inside a <script>: "</script>" and "<!--" in a note must not end the element. */
function js(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/**
 * The target a press on the page is for: the first target (in file order) whose
 * down/up/tap the document handles anywhere, read from the raw JSON. In a toggle that
 * is the track, not the knob. Null when nothing is pressable, and the button is left out.
 */
function firstTarget(text: string): string | null {
  try {
    const doc = JSON.parse(text);
    const targets: string[] = Array.isArray(doc.targets) ? doc.targets.filter((t: unknown) => typeof t === "string") : [];
    const handled = new Set<string>();
    const walk = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key === "when" && value && typeof value === "object") for (const event of Object.keys(value as object)) handled.add(event);
        walk(value);
      }
    };
    walk(doc);
    return targets.find((t) => ["down", "up", "tap"].some((e) => handled.has(`${t}.${e}`))) ?? null;
  } catch {
    return null;
  }
}

function describeEvents(events: TimedEvent[]): string {
  const parts: string[] = [];
  const inputs = new Set<string>();
  for (const e of events) {
    if ("event" in e) {
      if (!e.implied) parts.push(`${e.event} @ ${e.t}s`);
    } else if (!inputs.has(e.input)) {
      inputs.add(e.input);
      parts.push(`${e.input} samples`);
    }
  }
  return parts.join(", ") || "none";
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
