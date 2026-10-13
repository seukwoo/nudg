import type { Ease } from "./types.ts";

/** Eased progress for `u` in [0, 1]. */
export function easeAt(ease: Ease, u: number): number {
  if (ease === "linear") return u;
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const [x1, y1, x2, y2] = ease;
  return bezier(y1, y2, solveX(x1, x2, u));
}

/** d(progress)/du, used to hand a tween's velocity to the next motion. */
export function easeSlope(ease: Ease, u: number): number {
  if (ease === "linear") return 1;
  const [x1, y1, x2, y2] = ease;
  const s = solveX(x1, x2, Math.min(1, Math.max(0, u)));
  const dx = bezierSlope(x1, x2, s);
  if (Math.abs(dx) > 1e-9) return bezierSlope(y1, y2, s) / dx;
  const h = 1e-6;
  const a = Math.min(u, 1 - h);
  return (easeAt(ease, a + h) - easeAt(ease, a)) / h;
}

function bezier(p1: number, p2: number, s: number): number {
  const r = 1 - s;
  return 3 * r * r * s * p1 + 3 * r * s * s * p2 + s * s * s;
}

function bezierSlope(p1: number, p2: number, s: number): number {
  const r = 1 - s;
  return 3 * r * r * p1 + 6 * r * s * (p2 - p1) + 3 * s * s * (1 - p2);
}

/** Bezier parameter s where x(s) = u. Newton first, bisection if it stalls. */
function solveX(x1: number, x2: number, u: number): number {
  let s = u;
  for (let i = 0; i < 8; i++) {
    const err = bezier(x1, x2, s) - u;
    if (Math.abs(err) < 1e-12) return s;
    const slope = bezierSlope(x1, x2, s);
    if (Math.abs(slope) < 1e-9) break;
    s -= err / slope;
  }
  let lo = 0;
  let hi = 1;
  s = u;
  for (let i = 0; i < 64; i++) {
    const x = bezier(x1, x2, s);
    if (Math.abs(x - u) < 1e-12) break;
    if (x < u) lo = s;
    else hi = s;
    s = (lo + hi) / 2;
  }
  return s;
}
