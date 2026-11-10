// A one-off motion on one element: an entrance on mount (a trophy drops in, a result pops),
// played again when something changes (a countdown's number), and let go at rest, so the
// element keeps its own styles. One hook instead of a CSS keyframe line, with reduced motion
// and the judge loop for free.
//
//   const ref = useNudgOnce(presets.drop());
//   <img ref={ref} src={trophy} />
//   const num = useNudgOnce(presets.pop(), { replay: [count] });

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { toProgram } from "../core/to-program.ts";
import type { Program } from "../core/types.ts";
import { play } from "../dom/play.ts";

export interface UseNudgOnceOptions {
  /** The event that plays it, default "host.show". */
  start?: string;
  /** Plays it again when any of these change, as a `useEffect` dependency list does. */
  replay?: unknown[];
  /** Which target the element is, default the file's first target. */
  target?: string;
  /** Files the document imports, as in useNudg. */
  files?: Record<string, unknown>;
  /** Default: the system's setting, followed as it changes. */
  reducedMotion?: boolean;
}

/** Plays `source` once on the element the returned ref is given, and lets go when it rests. */
export function useNudgOnce(source: Program | object, options: UseNudgOnceOptions = {}): (element: Element | null) => void {
  const key = "machine" in source ? source : JSON.stringify(source);
  const program = useMemo(() => toProgram(source, options.files), [key]);
  const [element, setElement] = useState<Element | null>(null);
  const ref = useCallback((el: Element | null) => setElement(el), []);
  const target = options.target ?? program.targets[0];
  const start = options.start ?? "host.show";
  // By value, so an inline array (`replay: [count]`) doesn't replay on every render.
  const replay = JSON.stringify(options.replay ?? []);
  useIsomorphicLayoutEffect(() => {
    if (!element) return;
    // Bound before the browser paints, so the first frame is the way in's start, not a flash of the end.
    const player = play(program, null, { bind: { [target]: element }, start, release: "settle", reducedMotion: options.reducedMotion });
    return () => player.destroy();
  }, [element, program, target, start, replay, options.reducedMotion]);
  return ref;
}

const useIsomorphicLayoutEffect = typeof document === "undefined" ? useEffect : useLayoutEffect;
