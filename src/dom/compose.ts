// Several players on one element compose, as stacked modifiers do on SwiftUI and Compose:
// the element's own transform stays outermost, each player's transform follows in the order
// they bound it, and opacities multiply. Size and color can't be combined; the last writer
// keeps them and the conflict is reported once.

import type { NudgStyle } from "./style.ts";

interface Composer {
  /** The element's own transform (inline, or from a stylesheet), outermost. */
  author: string;
  /** Each player's latest style for this element, in bind order. */
  layers: Map<object, NudgStyle>;
  /** Inline values as they were before any player wrote them, to put back when the last one leaves. */
  original: Map<string, [value: string, priority: string]>;
  warned: Set<string>;
  /** CSS properties whose page transitions and animations have been turned off on the element. */
  quieted: Set<string>;
}

const composers = new WeakMap<Element, Composer>();

/** A style object's key as the CSS property name: `backgroundColor` → `background-color`. */
const cssName = (key: string) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

// The transform nudg itself writes, as the React adapter's first-frame `style()` puts it inline:
// that is nudg's, not the author's.
const NUDG_TRANSFORM = /^translate\([^)]*px, [^)]*px\) rotate\([^)]*deg\) scale\([^)]*\)$/;

function authorTransform(el: Element): string {
  const style = (el as HTMLElement).style;
  const inline = style.transform;
  if (inline && !NUDG_TRANSFORM.test(inline)) return inline;
  // Without an inline one, a stylesheet's transform (a class that centres a badge) would be
  // replaced by the inline one nudg writes, so it is carried over too.
  style.transform = "";
  const computed = typeof getComputedStyle === "function" ? getComputedStyle(el).transform : "none";
  style.transform = inline;
  return computed && computed !== "none" ? computed : "";
}

/** Writes `layer`'s style for `owner` and composes it with the other players' on the element. */
export function composeStyle(el: Element, owner: object, layer: NudgStyle, where: string) {
  const style = (el as HTMLElement | SVGElement).style;
  if (!style) return;
  let c = composers.get(el);
  if (!c) {
    c = { author: authorTransform(el), layers: new Map(), original: new Map(), warned: new Set(), quieted: new Set() };
    composers.set(el, c);
  }
  quiet(el, style, c, Object.keys(layer).map(cssName), where);
  for (const key of Object.keys(layer)) {
    const name = cssName(key);
    if (!c.original.has(name)) c.original.set(name, [style.getPropertyValue(name), style.getPropertyPriority(name)]);
  }
  if (!c.layers.has(owner)) {
    // A size or color another player also writes can't be combined: say so once.
    for (const key of Object.keys(layer)) {
      if (key === "transform" || key === "opacity" || c.warned.has(key)) continue;
      if ([...c.layers.values()].some((other) => key in other)) {
        c.warned.add(key);
        console.warn(`nudg: two players write ${cssName(key)} on the same element (${where}); the last one bound keeps it.`);
      }
    }
  }
  c.layers.set(owner, layer);
  write(style, c);
}

/** `owner` lets go of the element; the last one to leave puts back the element's own inline values. */
export function releaseStyle(el: Element, owner: object) {
  const c = composers.get(el);
  if (!c || !c.layers.delete(owner)) return;
  const style = (el as HTMLElement | SVGElement).style;
  if (c.layers.size) return write(style, c);
  for (const [name, [value, priority]] of c.original) style.setProperty(name, value, priority);
  composers.delete(el);
}

const TRANSITION = ["transition-property", "transition-duration", "transition-timing-function", "transition-delay", "transition-behavior"];
const ANIMATION = ["animation-name", "animation-duration", "animation-timing-function", "animation-delay", "animation-iteration-count", "animation-direction", "animation-fill-mode", "animation-play-state"];
/** What a page's `transition: all` keeps doing once nudg owns the moving properties. */
const NOT_MOVING = ["color", "background-color", "border-color", "outline-color", "box-shadow", "filter", "fill", "stroke", "text-decoration-color"];
/** Warned once per page, per property and class, so a playEach over every button says it once. */
const pageWarned = new Set<string>();

/**
 * A page's CSS transition or animation on a property nudg writes would fight the file's
 * motion: every frame nudg writes is eased again by CSS, and a keyframe animation overwrites
 * it. Those are turned off on this element, the rest are kept, and the page is told once.
 */
function quiet(el: Element, style: CSSStyleDeclaration, c: Composer, names: string[], where: string) {
  const fresh = names.filter((n) => !c.quieted.has(n));
  if (!fresh.length || typeof getComputedStyle !== "function") return;
  for (const n of fresh) c.quieted.add(n);
  const written = new Set(c.quieted);
  // The individual transform properties move the same pixels as `transform`.
  if (written.has("transform")) for (const p of ["translate", "rotate", "scale"]) written.add(p);
  const computed = getComputedStyle(el);
  const list = (name: string) => computed.getPropertyValue(name).split(/,(?![^(]*\))/).map((v) => v.trim());
  const remember = (name: string) => {
    if (!c.original.has(name)) c.original.set(name, [style.getPropertyValue(name), style.getPropertyPriority(name)]);
  };
  const said: string[] = [];

  // Transitions: keep the entries for other properties, drop the ones nudg writes.
  const props = list("transition-property");
  const durations = list("transition-duration");
  if (props.some((p, i) => (p === "all" || written.has(p)) && parseFloat(durations[i % durations.length]) > 0)) {
    const keep: number[] = [];
    const expanded: string[] = [];
    props.forEach((p, i) => {
      if (p === "all") for (const q of NOT_MOVING) if (!written.has(q)) (keep.push(i), expanded.push(q));
      if (p !== "all" && !written.has(p)) (keep.push(i), expanded.push(p));
    });
    said.push(...props.filter((p) => p === "all" || written.has(p)).map((p) => `transition: ${p}`));
    for (const name of TRANSITION) {
      remember(name);
      const values = name === "transition-property" ? expanded : keep.map((i) => list(name)[i % list(name).length]);
      style.setProperty(name, values.length ? values.join(", ") : name === "transition-property" ? "none" : "");
    }
  }

  // Keyframe animations that write a property nudg writes are stopped; others keep running.
  const running = typeof (el as HTMLElement).getAnimations === "function" ? (el as HTMLElement).getAnimations() : [];
  const fighting = new Set<string>();
  for (const a of running) {
    const name = (a as Animation & { animationName?: string }).animationName;
    if (!name) continue;
    const frames = (a.effect as KeyframeEffect | null)?.getKeyframes?.() ?? [];
    if (frames.some((f) => Object.keys(f).some((k) => written.has(cssName(k))))) fighting.add(name);
  }
  if (fighting.size) {
    const names = list("animation-name");
    const keep = names.map((n, i) => (fighting.has(n) ? -1 : i)).filter((i) => i >= 0);
    said.push(...[...fighting].map((n) => `animation: ${n}`));
    for (const name of ANIMATION) {
      remember(name);
      const values = keep.map((i) => list(name)[i % list(name).length]);
      style.setProperty(name, values.length ? values.join(", ") : name === "animation-name" ? "none" : "");
    }
  }

  const key = `${said.join("|")}|${(el as HTMLElement).className}`;
  if (said.length && !pageWarned.has(key)) {
    pageWarned.add(key);
    const label = el.id ? `#${el.id}` : typeof (el as HTMLElement).className === "string" && (el as HTMLElement).className ? `.${(el as HTMLElement).className.trim().split(/\s+/).join(".")}` : el.tagName.toLowerCase();
    console.warn(`nudg: ${label} has ${said.join(" and ")} from the page's styles, which would fight the motion of ${where}. nudg turned it off on this element while the player runs; remove it from the stylesheet.`);
  }
}

function write(style: CSSStyleDeclaration, c: Composer) {
  const transforms: string[] = [];
  let opacity: number | undefined;
  const rest: Record<string, string> = {};
  for (const layer of c.layers.values()) {
    if (layer.transform !== undefined) transforms.push(layer.transform);
    if (layer.opacity !== undefined) opacity = (opacity ?? 1) * Number(layer.opacity);
    for (const [key, value] of Object.entries(layer)) if (key !== "transform" && key !== "opacity" && value !== undefined) rest[key] = value;
  }
  if (transforms.length) style.transform = c.author ? `${c.author} ${transforms.join(" ")}` : transforms.join(" ");
  if (opacity !== undefined) style.opacity = String(opacity);
  for (const [key, value] of Object.entries(rest)) {
    // CSS variables (custom properties) only go through setProperty.
    if (key.startsWith("--")) style.setProperty(key, value);
    else (style as unknown as Record<string, string>)[key] = value;
  }
}
