import { useEffect, useRef } from "react";

/** Calls `fn` when a state path becomes active, e.g. "swipe/replied". */
export function useEntered(state: string[], path: string, fn: () => void) {
  const was = useRef(state.includes(path));
  useEffect(() => {
    const now = state.includes(path);
    if (now && !was.current) fn();
    was.current = now;
  }, [state]);
}
