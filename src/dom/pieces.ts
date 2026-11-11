// Draws an emitter's pieces (1.4) in its element. The host marks templates inside it with
// data-nudg-piece (a confetti strip, a star, an emoji); pieces cycle through them by index.
// Without templates a piece is a small square in the element's text color.
//
//   <div data-nudg="confetti" style="position:absolute; inset:0; pointer-events:none">
//     <i data-nudg-piece class="strip"></i><i data-nudg-piece class="dot"></i>
//   </div>

import type { Piece } from "../core/runtime.ts";
import type { Emitter } from "../core/types.ts";

interface Layer {
  templates: HTMLElement[];
  hidden: [HTMLElement, string][];
  drawn: Map<string, HTMLElement>;
  /** Where each wave starts, in the layer's coordinates, taken when the wave first draws. */
  origins: Map<number, [number, number]>;
}

const layers = new WeakMap<Element, Layer>();

function layerOf(el: HTMLElement): Layer {
  let layer = layers.get(el);
  if (!layer) {
    const templates = [...el.querySelectorAll<HTMLElement>("[data-nudg-piece]")];
    // Templates are patterns, never shown themselves.
    const hidden: [HTMLElement, string][] = templates.map((t) => [t, t.style.display]);
    for (const t of templates) t.style.display = "none";
    layer = { templates, hidden, drawn: new Map(), origins: new Map() };
    layers.set(el, layer);
  }
  return layer;
}

/** The start point of `e` in `el`'s coordinates: the `from` element's center or edge. */
function origin(el: HTMLElement, from: Element | undefined, e: Emitter): [number, number] {
  const box = el.getBoundingClientRect();
  const r = (from ?? el).getBoundingClientRect();
  const x = e.at === "left" ? r.left : e.at === "right" ? r.right : r.left + r.width / 2;
  const y = e.at === "top" ? r.top : e.at === "bottom" ? r.bottom : r.top + r.height / 2;
  return [x - box.left, y - box.top];
}

export function drawPieces(el: HTMLElement, from: Element | undefined, e: Emitter, pieces: Piece[]) {
  const layer = layerOf(el);
  const seen = new Set<string>();
  for (const p of pieces) {
    const key = `${p.wave}:${p.index}`;
    seen.add(key);
    let o = layer.origins.get(p.wave);
    if (!o) layer.origins.set(p.wave, (o = origin(el, from, e)));
    let node = layer.drawn.get(key);
    if (!node) {
      const template = layer.templates[p.index % Math.max(1, layer.templates.length)];
      if (template) {
        node = template.cloneNode(true) as HTMLElement;
        node.removeAttribute("data-nudg-piece");
        node.style.display = layer.hidden[layer.templates.indexOf(template)][1];
      } else {
        node = document.createElement("span");
        Object.assign(node.style, { width: "8px", height: "8px", background: "currentColor" });
      }
      node.setAttribute("aria-hidden", "true");
      Object.assign(node.style, { position: "absolute", left: "0", top: "0", pointerEvents: "none", willChange: "transform, opacity" });
      el.append(node);
      layer.drawn.set(key, node);
    }
    node.style.transform = `translate(${o[0] + p.x}px, ${o[1] + p.y}px) translate(-50%, -50%) rotate(${p.rotation}deg) scale(${p.scale})`;
    node.style.opacity = String(p.opacity);
  }
  for (const [key, node] of layer.drawn) {
    if (seen.has(key)) continue;
    node.remove();
    layer.drawn.delete(key);
  }
  for (const wave of layer.origins.keys()) if (!pieces.some((p) => p.wave === wave)) layer.origins.delete(wave);
}

/** Removes every drawn piece and shows the templates again. */
export function clearPieces(el: Element) {
  const layer = layers.get(el);
  if (!layer) return;
  for (const node of layer.drawn.values()) node.remove();
  for (const [t, display] of layer.hidden) t.style.display = display;
  layers.delete(el);
}
