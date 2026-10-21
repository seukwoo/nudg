// CSS for a file's values, without touching the DOM: the DOM adapter writes it every frame,
// and a server renders the same first frame, so nothing jumps when the page hydrates.

import { initialValues, type InitialOptions } from "../core/player.ts";
import type { Value } from "../core/runtime.ts";
import type { Program } from "../core/types.ts";

export { initialValues, type InitialOptions };

const TRANSFORM_PROPS = new Set(["x", "y", "rotation", "scale", "scaleX", "scaleY"]);

/** CSS properties in camelCase (`backgroundColor`), as React's `style` and `element.style` take them. */
export type NudgStyle = Partial<Record<"transform" | "opacity" | "width" | "height" | "backgroundColor" | "fill", string>>;

/** The properties each target animates, in file order. */
export function propertiesByTarget(program: Program): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const key of program.properties.keys()) {
    const [target, prop] = key.split(".");
    out.set(target, [...(out.get(target) ?? []), prop]);
  }
  return out;
}

/** One target's values as CSS. Color is a background, or a fill for SVG elements. */
export function styleOf(target: string, props: string[], values: Record<string, Value>, svg = false): NudgStyle {
  const v = (prop: string, fallback: number) => (props.includes(prop) ? (values[`${target}.${prop}`] as number) : fallback);
  const style: NudgStyle = {};
  if (props.some((p) => TRANSFORM_PROPS.has(p))) {
    style.transform = `translate(${v("x", 0)}px, ${v("y", 0)}px) rotate(${v("rotation", 0)}deg) scale(${v("scale", 1) * v("scaleX", 1)}, ${v("scale", 1) * v("scaleY", 1)})`;
  }
  if (props.includes("opacity")) style.opacity = String(v("opacity", 1));
  if (props.includes("width")) style.width = `${v("width", 0)}px`;
  if (props.includes("height")) style.height = `${v("height", 0)}px`;
  if (props.includes("color")) style[svg ? "fill" : "backgroundColor"] = values[`${target}.color`] as string;
  return style;
}

/**
 * The first frame as CSS for every target, for server rendering:
 * `<div data-nudg="toast" style="${cssText(styles.toast)}">`. Hydrate with the same
 * `state` and `inputs`, and the adapter takes over without a visible jump.
 */
export function initialStyles(program: Program, options: InitialOptions & { svg?: string[] } = {}): Record<string, NudgStyle> {
  const values = initialValues(program, options);
  const out: Record<string, NudgStyle> = {};
  for (const [target, props] of propertiesByTarget(program)) out[target] = styleOf(target, props, values, options.svg?.includes(target));
  return out;
}

/** A style as an inline `style` attribute value: "transform: ...; opacity: 0". */
export function cssText(style: NudgStyle): string {
  return Object.entries(style)
    .map(([key, value]) => `${key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}: ${value}`)
    .join("; ");
}
