import type { Channels } from "./types.ts";

/** A mapped property's value for a source value: piecewise linear, held at the ends. */
export function interpolate(map: { from: number[]; to: Channels[] }, x: number): Channels {
  const { from, to } = map;
  // Walk the points in increasing order of `from`, whichever way they were written.
  const order = from[from.length - 1] > from[0] ? from.map((_, i) => i) : from.map((_, i) => from.length - 1 - i);
  const first = order[0];
  const last = order[order.length - 1];
  if (x <= from[first]) return to[first].slice();
  if (x >= from[last]) return to[last].slice();
  for (let k = 0; k < order.length - 1; k++) {
    const i = order[k];
    const j = order[k + 1];
    if (x <= from[j]) {
      const u = (x - from[i]) / (from[j] - from[i]);
      return to[i].map((c, n) => c + (to[j][n] - c) * u);
    }
  }
  return to[last].slice();
}
