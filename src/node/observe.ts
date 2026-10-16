// Host truth: opens a real page in Chrome, performs the actions a person would, measures
// the element every frame (transform, opacity, size, presence), and reports what the
// page actually showed. The file says what should happen; this says what did.

import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { decomposeMatrix, summarizeHost, type HostSeries, type HostSummary } from "../core/observe.ts";
import { launchBrowser, waitFor } from "./cdp.ts";
import { TYPES, listen } from "./render.ts";

/** An action on the element at a time: what a finger or a key would do. */
export interface HostAction {
  t: number;
  /** down, up, tap (down then up), hover, leave, or key:<name> (Escape, Enter, Space, ArrowLeft, ...). */
  action: string;
}

export interface ObserveOptions {
  /** An http(s) URL, or a local .html path (served from the working directory, so its relative imports resolve). */
  url: string;
  /** CSS selector for the element to measure; shadow roots are searched too. */
  selector: string;
  actions: HostAction[];
  /** Seconds to keep measuring after the last action. Default 1.5. */
  settle?: number;
  /** Seconds to wait for the page's own scripts before acting. Default 0.5. */
  warmup?: number;
  chrome: string;
  /** Viewport, for pages that lay out differently on a phone. */
  viewport?: { width: number; height: number };
}

export interface Observation {
  url: string;
  selector: string;
  series: HostSeries;
  summary: HostSummary;
  /** Exceptions the page threw while observed; a still element with an error here is a broken page, not a missing binding. */
  errors: string[];
}

const KEYS: Record<string, { key: string; code: string; keyCode: number }> = {
  escape: { key: "Escape", code: "Escape", keyCode: 27 },
  enter: { key: "Enter", code: "Enter", keyCode: 13 },
  space: { key: " ", code: "Space", keyCode: 32 },
  tab: { key: "Tab", code: "Tab", keyCode: 9 },
  arrowleft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  arrowup: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  arrowright: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  arrowdown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  home: { key: "Home", code: "Home", keyCode: 36 },
  end: { key: "End", code: "End", keyCode: 35 },
  backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  delete: { key: "Delete", code: "Delete", keyCode: 46 },
  pageup: { key: "PageUp", code: "PageUp", keyCode: 33 },
  pagedown: { key: "PageDown", code: "PageDown", keyCode: 34 },
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`f${i + 1}`, { key: `F${i + 1}`, code: `F${i + 1}`, keyCode: 112 + i }])),
};

export const ACTIONS = "down, up, tap (down, held 80 ms, up), hover, leave, or key:<name> (a letter, or escape, enter, space, tab, arrow keys, home, end, pageup, pagedown, backspace, delete, f1-f12: every key the format names)";

/** How long a tap holds the pointer down, in seconds: a finger's quick tap. */
export const TAP_HOLD = 0.08;

/** Checks an action name the way the CLI and MCP tool do; returns a message when it's wrong. */
export function checkAction(action: string): string | undefined {
  if (["down", "up", "tap", "hover", "leave"].includes(action)) return undefined;
  if (action.startsWith("key:")) {
    const name = action.slice(4).toLowerCase();
    return name.length === 1 || KEYS[name] ? undefined : `Unknown key "${action.slice(4)}". Use a letter, or one of ${Object.keys(KEYS).join(", ")}.`;
  }
  return `Unknown action "${action}". Actions are ${ACTIONS}.`;
}

export async function observe(options: ObserveOptions): Promise<Observation> {
  for (const a of options.actions) {
    const problem = checkAction(a.action);
    if (problem) throw new Error(problem);
  }
  const actions = [...options.actions].sort((a, b) => a.t - b.t);
  const { url, close: closeServer } = await serveIfLocal(options.url);
  const browser = await launchBrowser(options.chrome);
  try {
    if (options.viewport) await browser.send("Emulation.setDeviceMetricsOverride", { ...options.viewport, deviceScaleFactor: 1, mobile: false });
    await browser.send("Page.enable");
    await browser.send("Runtime.enable");
    const errors: string[] = [];
    browser.on("Runtime.exceptionThrown", (p) => errors.push(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text ?? "page error"));
    let navigatedTo: string | undefined;
    let loaded = false;
    browser.on("Page.frameNavigated", (p) => {
      if (loaded && !p.frame?.parentId) navigatedTo = p.frame?.url;
    });
    const nav = await browser.send("Page.navigate", { url });
    if (nav?.errorText) throw new Error(`Could not load ${options.url}: ${nav.errorText}. Is the dev server running?`);
    await waitFor(() => browser.evaluate(`document.readyState === "complete" ? "ready" : ""`), 20_000);
    loaded = true;
    await new Promise((r) => setTimeout(r, (options.warmup ?? 0.5) * 1000));
    const found = await browser.evaluate(`(${deepQuery.toString()})(${JSON.stringify(options.selector)}) !== null`);
    if (!found) throw new Error(`No element matches ${JSON.stringify(options.selector)} on ${options.url}.${errors.length ? ` The page threw: ${errors[0]}` : ""}`);

    await browser.evaluate(`window.__nudgObserve = (${observer.toString()})(${JSON.stringify(options.selector)}, ${deepQuery.toString()}, ${decomposeMatrix.toString()})`);
    // A redirect during warmup landed on the page we're now observing; only later navigations count.
    navigatedTo = undefined;
    // A page that navigates away (a link, a router, a form) has no observer any more; say so.
    const inPage = async (expression: string, during: string) => {
      if (navigatedTo !== undefined) throw new Error(`The page navigated to ${navigatedTo} during "${during}", so the element could not be measured further.`);
      try {
        return await browser.evaluate(expression);
      } catch (e) {
        if (navigatedTo !== undefined) throw new Error(`The page navigated to ${navigatedTo} during "${during}", so the element could not be measured further.`);
        throw e;
      }
    };
    const started = Date.now();
    for (const a of actions) {
      const wait = started + a.t * 1000 - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      if (a.action === "tap") {
        // A finger's tap: down, a short hold, up. Marked as both, so the file sees the same two moments.
        const center = await inPage(`window.__nudgObserve.mark("down")`, "down");
        await perform(browser, "down", center);
        await new Promise((r) => setTimeout(r, TAP_HOLD * 1000));
        await inPage(`window.__nudgObserve.mark("up")`, "up");
        await perform(browser, "up", center);
        continue;
      }
      const center = await inPage(`window.__nudgObserve.mark(${JSON.stringify(a.action)})`, a.action);
      await perform(browser, a.action, center);
    }
    await new Promise((r) => setTimeout(r, (options.settle ?? 1.5) * 1000));
    const series: HostSeries = await inPage("window.__nudgObserve.stop()", "the settle time");
    return { url: options.url, selector: options.selector, series, summary: summarizeHost(series), errors };
  } finally {
    await browser.close();
    closeServer();
  }
}

async function perform(browser: { send(method: string, params?: Record<string, unknown>): Promise<unknown> }, action: string, center: { x: number; y: number } | null): Promise<void> {
  const at = center ?? { x: 1, y: 1 };
  const mouse = (type: string, extra: Record<string, unknown> = {}) => browser.send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, ...extra });
  if (action === "hover") return void (await mouse("mouseMoved"));
  if (action === "leave") return void (await browser.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0 }));
  if (action === "down" || action === "tap") {
    await mouse("mouseMoved");
    await mouse("mousePressed", { button: "left", clickCount: 1 });
  }
  if (action === "up" || action === "tap") await mouse("mouseReleased", { button: "left", clickCount: 1 });
  if (action.startsWith("key:")) {
    const name = action.slice(4);
    const k = KEYS[name.toLowerCase()] ?? { key: name, code: `Key${name.toUpperCase()}`, keyCode: name.toUpperCase().charCodeAt(0) };
    const params = { key: k.key, code: k.code, windowsVirtualKeyCode: k.keyCode, nativeVirtualKeyCode: k.keyCode };
    await browser.send("Input.dispatchKeyEvent", { type: "keyDown", ...params, ...(k.key.length === 1 ? { text: k.key } : {}) });
    await browser.send("Input.dispatchKeyEvent", { type: "keyUp", ...params });
  }
}

/** Runs inside the page: finds the selector through open shadow roots. */
function deepQuery(selector: string): Element | null {
  const walk = (root: Document | ShadowRoot | Element): Element | null => {
    const hit = root.querySelector(selector);
    if (hit) return hit;
    for (const el of root.querySelectorAll("*")) {
      if (el.shadowRoot) {
        const inner = walk(el.shadowRoot);
        if (inner) return inner;
      }
    }
    return null;
  };
  return walk(document);
}

/** Runs inside the page: samples the element every frame until stopped. */
function observer(selector: string, find: (s: string) => Element | null, decompose: (m: [number, number, number, number, number, number]) => { x: number; y: number; scaleX: number; scaleY: number; rotation: number }) {
  const t0 = performance.now();
  const samples: { t: number; present: boolean; values: Record<string, number> }[] = [];
  const marks: { t: number; action: string }[] = [];
  let el = find(selector);
  let unmountedAt: number | undefined;
  let remountedAt: number | undefined;
  let raf = 0;
  const now = () => Math.round(performance.now() - t0) / 1000;
  const read = () => {
    const t = now();
    const cur = find(selector);
    if (!cur) {
      if (unmountedAt === undefined) unmountedAt = t;
      samples.push({ t, present: false, values: {} });
      return;
    }
    if (cur !== el) {
      if (remountedAt === undefined) remountedAt = t;
      el = cur;
    }
    const cs = getComputedStyle(el);
    let m: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];
    // Only the argument list: the "3" in "matrix3d" is not a number.
    const args = /^matrix(3d)?\((.*)\)$/.exec(cs.transform);
    const nums = args?.[2].split(",").map(Number);
    if (args?.[1] && nums && nums.length === 16) m = [nums[0], nums[1], nums[4], nums[5], nums[12], nums[13]];
    else if (args && !args[1] && nums && nums.length === 6) m = nums as typeof m;
    const d = decompose(m);
    const h = el as HTMLElement;
    const round = (v: number) => Math.round(v * 1000) / 1000;
    samples.push({
      t,
      present: true,
      values: {
        x: round(d.x),
        y: round(d.y),
        scale: round(d.scaleX),
        scaleX: round(d.scaleX),
        scaleY: round(d.scaleY),
        rotation: round(d.rotation),
        opacity: round(Number(cs.opacity)),
        width: round(h.offsetWidth ?? 0),
        height: round(h.offsetHeight ?? 0),
      },
    });
  };
  const loop = () => {
    read();
    raf = requestAnimationFrame(loop);
  };
  loop();
  return {
    mark(action: string) {
      marks.push({ t: now(), action });
      const r = find(selector)?.getBoundingClientRect();
      return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    },
    stop() {
      cancelAnimationFrame(raf);
      read();
      return { samples, marks, unmountedAt, remountedAt };
    },
  };
}

/** A local .html path is served from the working directory on 127.0.0.1 for the length of the observation. */
export async function serveIfLocal(target: string): Promise<{ url: string; close(): void }> {
  if (/^https?:\/\//.test(target)) return { url: target, close() {} };
  const path = resolve(target);
  if (!existsSync(path)) throw new Error(`File not found: ${target}`);
  const root = process.cwd();
  const rel = relative(root, path);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`${target} is outside the working directory; run nudg from a folder that contains the page and what it imports.`);
  const server = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
    const file = resolve(root, "." + p);
    if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { "content-type": "text/plain" });
      return res.end("not found");
    }
    res.writeHead(200, { "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(readFileSync(file));
  });
  const port = await listen(server);
  return { url: `http://127.0.0.1:${port}/${rel.split(sep).map(encodeURIComponent).join("/")}`, close: () => server.close() };
}
