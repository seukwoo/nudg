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
    c = { author: authorTransform(el), layers: new Map(), original: new Map(), warned: new Set() };
    composers.set(el, c);
  }
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
  Object.assign(style, rest);
}
