// Colors the app names (1.8), read from CSS custom properties: `host.colors.hover` from
// `--hover` (or the property the app maps it to), on the element the player is bound to,
// at bind and again when the theme changes.

import { colorToHex } from "../core/color.ts";

let context: CanvasRenderingContext2D | null | undefined;

/**
 * Any CSS color as #RRGGBBAA, or undefined if it isn't one. The browser parses it (named
 * colors, rgb(), hsl(), oklch(), color-mix() …) and draws one pixel, so every form it
 * understands comes out the same way, in sRGB.
 */
export function cssColorToHex(value: string): string | undefined {
  const text = value.trim();
  if (!text) return undefined;
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(text)) return text;
  if (context === undefined) {
    const canvas = typeof document === "undefined" ? undefined : document.createElement("canvas");
    if (canvas) canvas.width = canvas.height = 1;
    context = canvas?.getContext("2d", { willReadFrequently: true }) ?? null;
  }
  if (!context) return colorToHex(text);
  // An invalid color leaves fillStyle as it was; two different starting points tell them apart.
  context.fillStyle = "#000";
  context.fillStyle = text;
  const a = context.fillStyle;
  context.fillStyle = "#fff";
  context.fillStyle = text;
  if (context.fillStyle !== a) return undefined;
  context.clearRect(0, 0, 1, 1);
  context.fillRect(0, 0, 1, 1);
  const [r, g, b, alpha] = context.getImageData(0, 0, 1, 1).data;
  return "#" + [r, g, b, alpha].map((c) => c.toString(16).padStart(2, "0")).join("");
}

/** The CSS custom property a named color is read from: `--<name>` unless the app maps it. */
export function colorVariable(name: string, map: Partial<Record<string, string>> | undefined): string {
  const mapped = map?.[name];
  return mapped === undefined ? `--${name}` : mapped.startsWith("--") ? mapped : `--${mapped}`;
}

/** Each named color as the element shows it now; names whose variable isn't set are left out. */
export function readColors(names: string[], el: Element | undefined, map: Partial<Record<string, string>> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!el || typeof getComputedStyle !== "function") return out;
  const style = getComputedStyle(el);
  for (const name of names) {
    const hex = cssColorToHex(style.getPropertyValue(colorVariable(name, map)));
    if (hex) out[name] = hex;
  }
  return out;
}

/**
 * Calls `changed` when the theme may have changed: the system's light or dark setting, or a
 * class, style or data attribute on <html> or <body>, where apps switch themes.
 */
export function watchTheme(changed: () => void): () => void {
  const scheme = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : undefined;
  scheme?.addEventListener?.("change", changed);
  let observer: MutationObserver | undefined;
  if (typeof MutationObserver === "function" && typeof document !== "undefined") {
    observer = new MutationObserver(changed);
    for (const el of [document.documentElement, document.body]) if (el) observer.observe(el, { attributes: true });
  }
  return () => {
    scheme?.removeEventListener?.("change", changed);
    observer?.disconnect();
  };
}
