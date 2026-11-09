// The rule React Native's `compose` applies, without React Native, so it can be tested.

export type Style = Record<string, unknown> | undefined | null | false;

/** The composing rule, with the multiplication passed in (Animated.multiply in an app). */
export function composeWith(multiply: (a: unknown, b: unknown) => unknown, styles: Style[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const transform: unknown[] = [];
  let opacity: unknown;
  for (const style of styles) {
    if (!style) continue;
    for (const [key, value] of Object.entries(style)) {
      if (key === "transform" && Array.isArray(value)) transform.push(...value);
      else if (key === "opacity") opacity = opacity === undefined ? value : typeof opacity === "number" && typeof value === "number" ? opacity * value : multiply(opacity, value);
      else out[key] = value;
    }
  }
  if (transform.length) out.transform = transform;
  if (opacity !== undefined) out.opacity = opacity;
  return out;
}
