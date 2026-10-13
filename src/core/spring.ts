// Damped harmonic oscillator, solved in closed form so results don't depend on frame rate.

import type { SpringMotion } from "./types.ts";

/** Damping ratios this close to 1 are treated as critically damped. */
const CRITICAL_EPSILON = 1e-9;

/**
 * Displacement and velocity `t` seconds after start, where `x0` is the starting
 * displacement from the target and `v0` the starting velocity.
 */
export function springAt(spring: SpringMotion, x0: number, v0: number, t: number): [number, number] {
  const { stiffness: k, damping: c, mass: m } = spring;
  const w0 = Math.sqrt(k / m);
  const zeta = c / (2 * Math.sqrt(k * m));

  if (Math.abs(zeta - 1) < CRITICAL_EPSILON) {
    const e = Math.exp(-w0 * t);
    const b = v0 + w0 * x0;
    return [e * (x0 + b * t), e * (b - w0 * (x0 + b * t))];
  }

  if (zeta < 1) {
    const decay = zeta * w0;
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    const e = Math.exp(-decay * t);
    const b = (v0 + decay * x0) / wd;
    const cos = Math.cos(wd * t);
    const sin = Math.sin(wd * t);
    const x = e * (x0 * cos + b * sin);
    return [x, -decay * x + e * wd * (b * cos - x0 * sin)];
  }

  const root = Math.sqrt(zeta * zeta - 1);
  const r1 = -w0 * (zeta - root);
  const r2 = -w0 * (zeta + root);
  const c2 = (v0 - r1 * x0) / (r2 - r1);
  const c1 = x0 - c2;
  const e1 = Math.exp(r1 * t);
  const e2 = Math.exp(r2 * t);
  return [c1 * e1 + c2 * e2, c1 * r1 * e1 + c2 * r2 * e2];
}

/** The default form: perceptual duration (seconds) and bounce, with mass 1. */
export function fromDurationBounce(duration: number, bounce: number): Omit<SpringMotion, "kind"> {
  const stiffness = (2 * Math.PI / duration) ** 2;
  return { stiffness, damping: 2 * (1 - bounce) * Math.sqrt(stiffness), mass: 1 };
}

export function fromStiffnessRatio(stiffness: number, dampingRatio: number): Omit<SpringMotion, "kind"> {
  return { stiffness, damping: 2 * dampingRatio * Math.sqrt(stiffness), mass: 1 };
}
