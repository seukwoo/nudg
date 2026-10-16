// A snapshot of a component as it is on a running page: its markup with the computed
// styles inlined, so the compare page can play two versions of its motion on the real
// thing without the app's CSS, fonts or build. What the snapshot can't carry
// (pseudo-elements, web fonts, hover and state styles, references outside the element)
// is reported, not assumed.

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
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
  const local = !/^https?:\/\//.test(options.url);
  const { url, close } = await serveIfLocal(options.url);
  const browser = await launchBrowser(options.chrome);
  try {
    if (options.viewport) await browser.send("Emulation.setDeviceMetricsOverride", { ...options.viewport, deviceScaleFactor: 1, mobile: false });
    await browser.send("Page.enable");
    const nav = await browser.send("Page.navigate", { url });
    if (nav?.errorText) throw new Error(`Could not load ${options.url}: ${nav.errorText}. Is the dev server running?`);
    await waitFor(() => browser.evaluate(`document.readyState === "complete" ? "ready" : ""`), 20_000);
    await new Promise((r) => setTimeout(r, (options.warmup ?? 0.5) * 1000));
    const result = await browser.evaluate(`(${snapshotInPage.toString()})(${JSON.stringify(options.selector ?? null)}, ${JSON.stringify(options.targets ?? [])})`);
    if (result.error) throw new Error(`${result.error} (${options.url})`);
    const notes: string[] = [...result.notes];
    if (result.unbound.length) notes.push(`not on the page: ${result.unbound.map((t: string) => `[data-nudg="${t}"]`).join(", ")}; the adapter marks bound elements with data-nudg, so the app may not be running this file, or binds under another name`);
    if (result.fidelity.pseudoElements) notes.push(`${result.fidelity.pseudoElements} ::before/::after with content were dropped (a snapshot can't carry pseudo-elements)`);
    if (result.fidelity.webFonts.length) notes.push(`web fonts fall back to system fonts: ${result.fidelity.webFonts.join(", ")}`);
    // A local page was served from a throwaway port; its resources must resolve from the file instead.
    let markup: string = result.markup;
    let base = url;
    if (local) {
      const origin = new URL(url).origin + "/";
      const dir = pathToFileURL(process.cwd()).href + "/";
      markup = markup.split(origin).join(dir);
      base = pathToFileURL(resolve(options.url)).href;
    }
    const html = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<base href="${escapeAttr(base)}">\n<title>Snapshot of ${escapeAttr(result.selector)}</title>\n<style>body { margin: 16px; }</style>\n</head>\n<body>\n${markup}\n</body>\n</html>\n`;
    return { html, markup, selector: result.selector, bound: result.bound, unbound: result.unbound, fidelity: result.fidelity, notes };
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
  const notes: string[] = [];
  const deep = (root: Document | ShadowRoot | Element, sel: string, all: Element[] = []): Element[] => {
    all.push(...root.querySelectorAll(sel));
    for (const el of root.querySelectorAll("*")) if (el.shadowRoot) deep(el.shadowRoot, sel, all);
    return all;
  };
  const hostOf = (el: Element): Element | null => el.parentElement ?? ((el.getRootNode() as ShadowRoot).host ?? null);
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
    const contains = (a: Element, b: Element) => a.contains(b) || (a.shadowRoot?.contains(b) ?? false) || [...a.querySelectorAll("*")].some((d) => d.shadowRoot?.contains(b));
    for (const el of els.slice(1)) while (common && !contains(common, el)) common = hostOf(common);
    root = common;
    // A positioned target alone loses its containing block; take that instead.
    const pos = root ? getComputedStyle(root).position : "";
    const container = root instanceof HTMLElement ? root.offsetParent : null;
    if (root && (pos === "absolute" || pos === "fixed") && container instanceof Element && container !== document.body) {
      notes.push(`${describe(root)} is positioned ${pos}; snapshotted its container ${describe(container)} so it keeps its place (pass --select to choose)`);
      root = container;
    }
    if (root === document.body || root === document.documentElement) notes.push("the targets share no container but the page body, so the whole body was snapshotted; pass --select to narrow it");
    chosen = root ? describe(root) : "";
  }
  if (!root) return { error: `No element matches ${JSON.stringify(selector)}` };

  // Defaults per tag, so only the styles the page added are inlined.
  const frame = document.createElement("iframe");
  frame.setAttribute("data-nudg-probe", "");
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
  const skipExact = new Set(["transform", "opacity", "transform-origin", "translate", "rotate", "scale", "offset-path"]);
  const skipPrefix = /^(transition|animation|-webkit-|perspective-origin)/;
  // Logical longhands repeat the physical ones Chrome already lists; one copy is enough.
  const logical = /(block|inline)-(start|end|size)|-(start|end)-(start|end)-radius|^inset-|^(margin|padding)-(block|inline)/;
  const loadedFonts = new Set<string>();
  try {
    document.fonts.forEach((f) => loadedFonts.add(f.family.replace(/^"|"$/g, "")));
  } catch {
    // No font API: nothing to report.
  }
  const fonts = new Set<string>();
  let declarations = 0;
  let pseudo = 0;
  let elements = 0;
  const isRootPositioned = selector !== null && /^(absolute|fixed)$/.test(getComputedStyle(root).position);

  const inlineStyle = (el: Element, copy: Element, atRoot: boolean) => {
    const cs = getComputedStyle(el);
    const base = defaultsFor(el.tagName.toLowerCase());
    const decl: string[] = [];
    for (let k = 0; k < cs.length; k++) {
      const prop = cs[k];
      if (skipExact.has(prop) || skipPrefix.test(prop) || logical.test(prop)) continue;
      // An explicitly selected positioned root keeps its box but not its place in the old page.
      if (atRoot && isRootPositioned && /^(top|left|right|bottom|position)$/.test(prop)) continue;
      const value = cs.getPropertyValue(prop);
      if (value === base.getPropertyValue(prop)) continue;
      decl.push(`${prop}: ${value}`);
    }
    if (atRoot && isRootPositioned) decl.push("position: relative");
    declarations += decl.length;
    copy.setAttribute("style", decl.join("; "));
    copy.removeAttribute("data-nudg-state");
    for (const p of ["::before", "::after"]) {
      const c = getComputedStyle(el, p).content;
      if (c && c !== "none" && c !== "normal") pseudo++;
    }
    for (const f of cs.fontFamily.split(",")) {
      const name = f.trim().replace(/^"|"$/g, "");
      if (loadedFonts.has(name)) fonts.add(name);
    }
  };

  // A clone with styles inlined, shadow roots as declarative templates, the probe left out.
  const serialize = (el: Element, atRoot: boolean): Element | null => {
    if (el.hasAttribute("data-nudg-probe") || el.tagName === "SCRIPT") return null;
    elements++;
    const copy = el.cloneNode(false) as Element;
    inlineStyle(el, copy, atRoot);
    if (el.shadowRoot) {
      const template = document.createElement("template");
      template.setAttribute("shadowrootmode", "open");
      for (const child of el.shadowRoot.childNodes) {
        if (child instanceof Element) {
          if (child.tagName === "STYLE") continue;
          const c = serialize(child, false);
          if (c) template.content.append(c);
        } else template.content.append(child.cloneNode(true));
      }
      copy.append(template);
    }
    for (const child of el.childNodes) {
      if (child instanceof Element) {
        const c = serialize(child, false);
        if (c) copy.append(c);
      } else copy.append(child.cloneNode(true));
    }
    return copy;
  };

  let clone: Element;
  if (root === document.body || root === document.documentElement) {
    // Never emit a <body>: inside the compare page it would merge into the page's own body.
    const wrapper = document.createElement("div");
    inlineStyle(document.body, wrapper, false);
    elements++;
    for (const child of document.body.childNodes) {
      if (child instanceof Element) {
        const c = serialize(child, false);
        if (c) wrapper.append(c);
      } else wrapper.append(child.cloneNode(true));
    }
    clone = wrapper;
  } else clone = serialize(root, true)!;
  frame.remove();

  // Every bound target must have made it into the clone, shadow roots included.
  const inClone = (name: string) => clone.matches(`[data-nudg="${name}"]`) || clone.querySelector(`[data-nudg="${name}"]`) !== null || [...clone.querySelectorAll("template")].some((t) => t.content.querySelector(`[data-nudg="${name}"]`));
  const lost = bound.filter((t) => !inClone(t));
  if (lost.length) notes.push(`${lost.map((t) => `[data-nudg="${t}"]`).join(", ")} is on the page but outside ${chosen}; pass --select for an element that holds it`);
  // References that point outside the element break: SVG <use href="#id">, clip-path, mask.
  const refs = [...clone.querySelectorAll("use")].filter((u) => (u.getAttribute("href") ?? u.getAttribute("xlink:href") ?? "").startsWith("#") && !clone.querySelector((u.getAttribute("href") ?? u.getAttribute("xlink:href"))!));
  if (refs.length) notes.push(`${refs.length} <use href="#…"> reference symbols outside the element; those icons will be blank`);
  // Styles that depend on state can't be inlined: the page shows the resting look only.
  let stateRules = 0;
  try {
    for (const sheet of document.styleSheets) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of rules) if (rule instanceof CSSStyleRule && /data-nudg-state|:hover|:active|:focus/.test(rule.selectorText)) stateRules++;
    }
  } catch {
    // Cross-origin sheets: nothing to count.
  }
  if (stateRules) notes.push(`${stateRules} style rules depend on state (data-nudg-state, :hover, :active, :focus) and are not carried; only what the file animates will change`);

  return { markup: clone.outerHTML, selector: chosen, bound, unbound, notes, fidelity: { elements, declarations, pseudoElements: pseudo, webFonts: [...fonts] } };

  function describe(el: Element): string {
    if (el === document.body) return "body";
    if (el.id) return `#${el.id}`;
    const nudg = el.getAttribute("data-nudg");
    if (nudg) return `[data-nudg="${nudg}"]`;
    const cls = [...el.classList].slice(0, 2).map((c) => `.${CSS.escape(c)}`).join("");
    return `${el.tagName.toLowerCase()}${cls}`;
  }
}
