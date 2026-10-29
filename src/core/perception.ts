// How much a change must differ before a person can see it; compare and critique share it.

/**
 * Perception thresholds, in logical units and seconds. Below them a change is lost in the
 * display: under a device pixel at 1×, or under about three frames at 60 Hz. Rough, on
 * purpose: the point is to stop a judge from staring at a change nobody can see.
 */
export const THRESHOLDS = {
  position: { imperceptible: 1, subtle: 3 },
  /** Fractions of 1 for scale and opacity. */
  fraction: { imperceptible: 0.02, subtle: 0.06 },
  /** OKLab distance ×100. */
  color: { imperceptible: 2, subtle: 6 },
  time: { imperceptible: 0.05, subtle: 0.15 },
};
