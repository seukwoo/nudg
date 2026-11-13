// CSS for a file's values, without touching the DOM: the DOM adapter writes it every frame,
// and a server renders the same first frame, so nothing jumps when the page hydrates.

import { initialValues, type InitialOptions } from "../core/player.ts";
import type { Value } from "../core/runtime.ts";
import type { Program } from "../core/types.ts";

export { initialValues, type InitialOptions };

const TRANSFORM_PROPS = new Set(["x", "y", "rotation", "scale", "scaleX", "scaleY"]);

/**
 * CSS properties in camelCase (`backgroundColor`), as React's `style` and `element.style` take
 * them, plus a CSS variable per custom property (`--nudg-glow`, 1.3).
 */
export type NudgStyle = Partial<Record<"transform" | "opacity" | "width" | "height" | "backgroundColor" | "fill" | "boxShadow" | "filter", string>> & { [variable: `--nudg-${string}`]: string };

/** The shadow color when a file moves a shadow without giving one: a quarter-black. */
const SHADOW_COLOR = "#00000040";

/** The properties each target animates, in file order. */
export function propertiesByTarget(program: Program): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const key of program.properties.keys()) {
    const dot = key.indexOf(".");
    const target = key.slice(0, dot);
    out.set(target, [...(out.get(target) ?? []), key.slice(dot + 1)]);
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
  // A shadow, with its spread (1.6), and an inner shadow beside it (1.6): one box-shadow list.
  const shadows: string[] = [];
  const shadow = (prefix: string, inset: string) => {
    if (!props.some((p) => p.startsWith(prefix))) return;
    const color = props.includes(`${prefix}Color`) ? (values[`${target}.${prefix}Color`] as string) : SHADOW_COLOR;
    const spread = props.includes(`${prefix}Spread`) ? ` ${v(`${prefix}Spread`, 0)}px` : "";
    shadows.push(`${inset}${v(`${prefix}X`, 0)}px ${v(`${prefix}Y`, 0)}px ${Math.max(0, v(`${prefix}Blur`, 0))}px${spread} ${color}`);
  };
  shadow("shadow", "");
  shadow("inner", "inset ");
  if (shadows.length) style.boxShadow = shadows.join(", ");
  if (props.includes("blur")) style.filter = `blur(${Math.max(0, v("blur", 0))}px)`;
  // A custom property (1.3) is the host's to draw: a CSS variable it can use anywhere.
  for (const p of props) if (p.startsWith("custom.")) style[`--nudg-${p.slice(7)}`] = String(values[`${target}.${p}`]);
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
