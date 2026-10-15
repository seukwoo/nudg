// A snapshot of a component as it is on a running page: its markup with the computed
// styles inlined, so the compare page can play two versions of its motion on the real
// thing without the app's CSS, fonts or build. What the snapshot can't carry
// (pseudo-elements, web fonts, hover styles) is reported, not assumed.

import { launchBrowser, waitFor } from "./cdp.ts";
import { serveIfLocal } from "./observe.ts";

export interface SnapshotOptions {
  /** An http(s) URL of the running app, or a local .html path (served from the working directory). */
  url: string;
  /** CSS selector of the element to snapshot; shadow roots are searched. Default: the smallest element containing every bound target. */
  selector?: string;
  /** The file's target names, for the default selector and for checking they are bound on the page. */
  targets?: string[];
  chrome: string;
  viewport?: { width: number; height: number };
  /** Seconds to let the page's scripts start first. Default 0.5. */
  warmup?: number;
}

export interface Snapshot {
  /** A complete host page: the element's markup with computed styles inlined, a <base> for relative URLs. */
  html: string;
  /** The markup alone. */
  markup: string;
  /** The selector that was snapshotted. */
  selector: string;
  /** Targets found on the page, and the ones that weren't. */
  bound: string[];
  unbound: string[];
  /** How faithful the snapshot is: what was dropped. */
  fidelity: { elements: number; declarations: number; pseudoElements: number; webFonts: string[] };
  /** One line per thing the person should know. */
  notes: string[];
}

export async function snapshotElement(options: SnapshotOptions): Promise<Snapshot> {
  const { url, close } = await serveIfLocal(options.url);
  const browser = await launchBrowser(options.chrome);
  try {
    if (options.viewport) await browser.send("Emulation.setDeviceMetricsOverride", { ...options.viewport, deviceScaleFactor: 1, mobile: false });
    await browser.send("Page.enable");
    await browser.send("Page.navigate", { url });
    await waitFor(() => browser.evaluate(`document.readyState === "complete" ? "ready" : ""`), 20_000);
    await new Promise((r) => setTimeout(r, (options.warmup ?? 0.5) * 1000));
    const result = await browser.evaluate(`(${snapshotInPage.toString()})(${JSON.stringify(options.selector ?? null)}, ${JSON.stringify(options.targets ?? [])})`);
    if (result.error) throw new Error(`${result.error} (${options.url})`);
    const notes: string[] = [];
    if (result.unbound.length) notes.push(`not on the page: ${result.unbound.map((t: string) => `[data-nudg="${t}"]`).join(", ")}; the adapter marks bound elements with data-nudg, so the app may not be running this file, or binds under another name`);
    if (result.fidelity.pseudoElements) notes.push(`${result.fidelity.pseudoElements} ::before/::after with content were dropped (a snapshot can't carry pseudo-elements)`);
    if (result.fidelity.webFonts.length) notes.push(`web fonts fall back to system fonts: ${result.fidelity.webFonts.join(", ")}`);
    const html = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<base href="${escapeAttr(url)}">\n<title>Snapshot of ${escapeAttr(result.selector)}</title>\n<style>body { margin: 16px; }</style>\n</head>\n<body>\n${result.markup}\n</body>\n</html>\n`;
    return { html, markup: result.markup, selector: result.selector, bound: result.bound, unbound: result.unbound, fidelity: result.fidelity, notes };
  } finally {
    await browser.close();
    close();
  }
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** Runs inside the page. */
function snapshotInPage(selector: string | null, targets: string[]) {
  const deep = (root: Document | ShadowRoot | Element, sel: string, all: Element[] = []): Element[] => {
    all.push(...root.querySelectorAll(sel));
    for (const el of root.querySelectorAll("*")) if (el.shadowRoot) deep(el.shadowRoot, sel, all);
    return all;
  };
  const byTarget = new Map<string, Element>();
  for (const t of targets) {
    const el = deep(document, `[data-nudg="${t}"]`)[0];
    if (el) byTarget.set(t, el);
  }
  const bound = [...byTarget.keys()];
  const unbound = targets.filter((t) => !byTarget.has(t));

  let root: Element | null = null;
  let chosen = selector ?? "";
  if (selector) root = deep(document, selector)[0] ?? null;
  else {
    // The smallest element that contains every bound target: a toggle's track holds its knob.
    const els = [...byTarget.values()];
    if (els.length === 0) return { error: targets.length ? `None of ${targets.map((t) => `[data-nudg="${t}"]`).join(", ")} is on the page; pass a selector, or check the app binds this file` : "Pass a selector: the file names no targets" };
    let common: Element | null = els[0];
    for (const el of els.slice(1)) while (common && !common.contains(el)) common = common.parentElement ?? ((common.getRootNode() as ShadowRoot).host ?? null);
    root = common;
    chosen = root ? describe(root) : "";
  }
  if (!root) return { error: `No element matches ${JSON.stringify(selector)}` };

  // Defaults per tag, so only the styles the page added are inlined.
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:absolute;width:0;height:0;border:0;visibility:hidden";
  document.body.append(frame);
  const fdoc = frame.contentDocument!;
  const defaults = new Map<string, CSSStyleDeclaration>();
  const defaultsFor = (tag: string) => {
    let d = defaults.get(tag);
    if (!d) {
      const probe = fdoc.createElement(tag);
      fdoc.body.append(probe);
      d = frame.contentWindow!.getComputedStyle(probe);
      defaults.set(tag, d);
    }
    return d;
  };
  // What nudg animates stays out, so the file drives it; transitions would fight the springs.
  const skip = /^(transform|opacity|transition|animation|-webkit-|inline-size|block-size|perspective-origin|transform-origin$)/;
  const skipExact = new Set(["transform", "opacity", "transform-origin", "translate", "rotate", "scale", "offset-path"]);
  // Logical longhands repeat the physical ones Chrome already lists; one copy is enough.
  const logical = /(block|inline)-(start|end|size)|-(start|end)-(start|end)-radius|^inset-|^(margin|padding)-(block|inline)/;
  const fonts = new Set<string>();
  const loadedFonts = new Set<string>();
  try {
    document.fonts.forEach((f) => loadedFonts.add(f.family.replace(/^"|"$/g, "")));
  } catch {
    // No font API: nothing to report.
  }
  let declarations = 0;
  let pseudo = 0;
  const clone = root.cloneNode(true) as Element;
  const originals = [root, ...root.querySelectorAll("*")];
  const copies = [clone, ...clone.querySelectorAll("*")];
  originals.forEach((el, i) => {
    const copy = copies[i] as Element;
    if (!(copy instanceof HTMLElement || copy instanceof SVGElement)) return;
    const cs = getComputedStyle(el);
    const base = defaultsFor(el.tagName.toLowerCase());
    const decl: string[] = [];
    for (let k = 0; k < cs.length; k++) {
      const prop = cs[k];
      if (skipExact.has(prop) || logical.test(prop) || (skip.test(prop) && !prop.startsWith("transform-origin"))) continue;
      if (prop.startsWith("transition") || prop.startsWith("animation")) continue;
      const value = cs.getPropertyValue(prop);
      if (value === base.getPropertyValue(prop)) continue;
      decl.push(`${prop}: ${value}`);
    }
    declarations += decl.length;
    (copy as HTMLElement).setAttribute("style", decl.join("; "));
    copy.removeAttribute("data-nudg-state");
    for (const p of ["::before", "::after"]) {
      const c = getComputedStyle(el, p).content;
      if (c && c !== "none" && c !== "normal") pseudo++;
    }
    for (const f of cs.fontFamily.split(",")) {
      const name = f.trim().replace(/^"|"$/g, "");
      if (loadedFonts.has(name)) fonts.add(name);
    }
  });
  for (const s of clone.querySelectorAll("script")) s.remove();
  frame.remove();
  return { markup: clone.outerHTML, selector: chosen, bound, unbound, fidelity: { elements: originals.length, declarations, pseudoElements: pseudo, webFonts: [...fonts] } };

  function describe(el: Element): string {
    if (el.id) return `#${el.id}`;
    const nudg = el.getAttribute("data-nudg");
    if (nudg) return `[data-nudg="${nudg}"]`;
    const cls = [...el.classList].slice(0, 2).map((c) => `.${CSS.escape(c)}`).join("");
    return `${el.tagName.toLowerCase()}${cls}`;
  }
}
