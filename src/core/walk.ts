// Walks over a compiled program's parts.

import type { Machine, Motion, Program } from "./types.ts";

/** Every `animate` map in the program: the file's own and each transition's. */
export function animateMaps(program: Program): Map<string, Motion>[] {
  const out = [program.animate];
  const walk = (m: Machine) => {
    if (m.kind === "regions") return m.regions.forEach(walk);
    for (const t of m.when.values()) out.push(t.animate);
    for (const state of m.states.values()) {
      for (const t of state.when.values()) out.push(t.animate);
      for (const timer of state.timers) out.push(timer.transition.animate);
      if (state.machine) walk(state.machine);
    }
  };
  walk(program.machine);
  return out;
}
