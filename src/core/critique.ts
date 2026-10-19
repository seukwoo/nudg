// Motion critique: whether an interaction follows what the platforms' motion guidelines
// and accessibility rules ask for, transition by transition. `compare` says whether a
// change is visible; this says whether the motion is good. Every finding names its
// source and says how to fix it, like a validator error, but none of them is an error.

import { THRESHOLDS } from "./compare.ts";
import { createRuntime } from "./runtime.ts";
import type { Machine, Motion, Program, State } from "./types.ts";

export type CritiqueSeverity = "warning" | "suggestion";

export interface CritiqueFinding {
  code: string;
  severity: CritiqueSeverity;
  /** JSON pointer to the transition or state the finding is about. */
  path: string;
  message: string;
  hint: string;
  /** Where the rule comes from. */
  source: string;
}

/** One transition, played from rest: how each property it moves gets there. */
export interface MeasuredTransition {
  from: string;
  event: string;
  to: string;
  path: string;
  properties: { key: string; delta: number; t90: number; settle: number }[];
}

const SOURCES = {
  material: "Material 3 motion: durations and easing",
  apple: "Apple HIG: motion",
  wcag222: "WCAG 2.2.2 Pause, Stop, Hide / 2.2.1 Timing Adjustable",
  aria: "WAI-ARIA Authoring Practices: dialog and disclosure",
};

/** Seconds: press feedback should be most of the way there within about 100 ms. */
const FEEDBACK_T90 = 0.15;
/** Settle times past these feel slow for a UI element (Material's long durations top out near 0.6 s). */
const LONG = { suggestion: 0.6, warning: 1.0 };
const FRACTIONAL = new Set(["scale", "scaleX", "scaleY", "opacity"]);
const SCAN = 1 / 240;
const HORIZON = 3;

export function critique(program: Program): { findings: CritiqueFinding[]; transitions: MeasuredTransition[] } {
  const transitions = measureTransitions(program);
  const findings: CritiqueFinding[] = [];
  const add = (f: CritiqueFinding) => {
    if (!findings.some((g) => g.code === f.code && g.path === f.path)) findings.push(f);
  };

  for (const tr of transitions) {
    const moving = tr.properties.filter((p) => p.delta > 0);
    if (moving.length === 0) continue;
    const slowest = moving.reduce((a, b) => (b.settle > a.settle ? b : a));
    // Too long for a UI element.
    if (slowest.settle >= LONG.suggestion) {
      add({
        code: "slow-transition",
        severity: slowest.settle >= LONG.warning ? "warning" : "suggestion",
        path: tr.path,
        message: `${tr.from} → ${tr.to} on ${tr.event}: ${slowest.key} takes ${slowest.settle.toFixed(2)} s to settle.`,
        hint: "UI transitions usually settle within 0.2–0.5 s. Shorten the duration, or lower the bounce if it's the wobble that takes the time.",
        source: SOURCES.material,
      });
    }
    // Press feedback that arrives late.
    if (/\.down$/.test(tr.event)) {
      const fastest = moving.reduce((a, b) => (b.t90 < a.t90 ? b : a));
      if (fastest.t90 > FEEDBACK_T90) {
        add({
          code: "late-feedback",
          severity: "warning",
          path: tr.path,
          message: `Pressing reaches 90% of its feedback at ${fastest.t90.toFixed(2)} s (${fastest.key}).`,
          hint: "Press feedback should be mostly there within about 0.1 s: use a short spring (duration ≤ 0.15) or a quick tween for the press, and keep the slower motion for the release.",
          source: `${SOURCES.material}; ${SOURCES.apple}`,
        });
      }
    }
    // A change nobody can see.
    const visible = moving.some((p) => p.delta >= (FRACTIONAL.has(p.key.split(".")[1]) ? THRESHOLDS.fraction.imperceptible : THRESHOLDS.position.imperceptible));
    const colors = tr.properties.some((p) => p.delta < 0);
    if (!visible && !colors) {
      add({
        code: "invisible-change",
        severity: "warning",
        path: tr.path,
        message: `${tr.from} → ${tr.to} on ${tr.event} moves ${moving.map((p) => `${p.key} by ${p.delta.toFixed(FRACTIONAL.has(p.key.split(".")[1]) ? 3 : 2)}`).join(", ")}: under a pixel or 2%, so nobody will see it.`,
        hint: "Make the change bigger (a press of at least 0.03 in scale or 2 units in position), or drop it.",
        source: "nudg perception thresholds (compare)",
      });
    }
  }

  // Leaving takes longer than arriving.
  for (const go of transitions) {
    const back = transitions.find((b) => b.from === go.to && b.to === go.from && b.event !== go.event) ?? transitions.find((b) => b.from === go.to && b.to === go.from);
    if (!back || go.from !== initialPath(program)) continue;
    // A press and its release are meant to differ (a quick sink, a springy return); this is about things that leave.
    if (/\.(down|up|cancel|hoverstart|hoverend|focus|blur)$/.test(back.event)) continue;
    const sGo = Math.max(0, ...go.properties.filter((p) => p.delta !== 0).map((p) => p.settle));
    const sBack = Math.max(0, ...back.properties.filter((p) => p.delta !== 0).map((p) => p.settle));
    if (sGo > 0 && sBack > sGo * 1.25 + 0.05) {
      add({
        code: "slow-exit",
        severity: "suggestion",
        path: back.path,
        message: `Leaving ${go.to} takes ${sBack.toFixed(2)} s; arriving took ${sGo.toFixed(2)} s.`,
        hint: "Exits are usually quicker than entrances: the person has already moved on. Give the way back a shorter motion with \"animate\" on that transition.",
        source: SOURCES.material,
      });
    }
  }

  // Static rules.
  const bouncyFades = (motions: Map<string, Motion>, path: string) => {
    for (const [key, m] of motions) {
      const prop = key.split(".")[1];
      if (prop !== "opacity" && program.properties.get(key)?.kind !== "color") continue;
      if (m.kind === "spring" && m.damping < 2 * Math.sqrt(m.stiffness * m.mass) - 1e-9) {
        add({
          code: "bouncy-fade",
          severity: "suggestion",
          path: `${path}/${escape(key)}`,
          message: `${key} uses a spring that overshoots; ${prop === "opacity" ? "opacity can't go past 0 or 1, so the bounce is clipped" : "a color has nowhere to overshoot to"} and only delays settling.`,
          hint: "Use \"bounce\": 0 or a tween (\"fade\") for opacity and color, and keep the bounce for position and scale.",
          source: SOURCES.material,
        });
      }
    }
  };
  bouncyFades(program.animate, "/animate");
  forEachState(program.machine, "", (state, path) => {
    for (const [event, t] of state.when) bouncyFades(t.animate, `${path}/when/${escape(event)}/animate`);
    // Short auto-dismiss without a way to keep it.
    for (const timer of state.timers) {
      const movesSomething = state.set.size > 0;
      const pausable = timer.pause.length > 0;
      if (movesSomething && timer.delay < 4 && timer.transition.to !== undefined && !pausable) {
        add({
          code: "short-timeout",
          severity: "suggestion",
          path: `${path}/when/${escape(timer.key)}`,
          message: `${state.name} goes away after ${timer.delay} s, and nothing pauses it.`,
          hint: `Give people time to read it: Material snackbars stay 4–10 s. Add "pause" pairs for hover, focus and app suspension, or let it be dismissed instead.`,
          source: SOURCES.wcag222,
        });
      }
    }
    // Something that opens but can't be closed with Escape.
    // Only for things that take over the screen or focus: dialogs, sheets, menus, popovers.
    const overlay = program.targets.some((t) => /dialog|modal|sheet|menu|popover|scrim|backdrop|overlay/i.test(t));
    if (overlay && /^(open|opened|shown|visible|expanded|showing|half|full)$/i.test(state.name)) {
      const closes = [...state.when.entries()].some(([, t]) => t.to !== undefined && t.to !== state.name);
      const escape = [...state.when.keys()].some((e) => /\.key\.escape$/.test(e));
      if (closes && !escape && program.version >= "0.3") {
        add({
          code: "no-escape",
          severity: "suggestion",
          path: `${path}/when`,
          message: `"${state.name}" can be closed, but not with Escape.`,
          hint: `Add "<target>.key.escape" to "${state.name}"'s "when" with the same target as its close, on the element that has focus while it's open.`,
          source: SOURCES.aria,
        });
      }
    }
  });

  const order = (f: CritiqueFinding) => (f.severity === "warning" ? 0 : 1);
  findings.sort((a, b) => order(a) - order(b));
  return { findings, transitions };
}

/** Plays every event a leaf state handles, from rest, and measures what it moves. */
export function measureTransitions(program: Program): MeasuredTransition[] {
  const out: MeasuredTransition[] = [];
  const measured = new Set<string>();
  for (const configuration of stateConfigurations(program.machine, "", "")) {
    for (const { path, pointer, state, machine } of configuration.leaves) {
      const events = new Map<string, string>();
      for (const e of state.when.keys()) events.set(e, `${pointer}/when/${escape(e)}`);
      for (const e of machine.when.keys()) if (!events.has(e)) events.set(e, `${pointer.replace(/\/states\/[^/]+$/, "")}/when/${escape(e)}`);
      for (const [event, ptr] of events) {
        // Gestures need a drag to mean anything; timers are measured where they fire.
        if (/\.(dragstart|dragend)$/.test(event) || event.startsWith("after:")) continue;
        const id = `${path}\0${ptr}`;
        if (measured.has(id)) continue;
        measured.add(id);
        const rt = createRuntime(program, { state: configuration.paths });
        const before = rt.sample(0);
        const t0 = 0.05;
        if (!rt.send(event, t0)) continue;
        const to = rt.state().join(" ");
        const targets = rt.targets();
        const properties: MeasuredTransition["properties"] = [];
        for (const [key, prop] of program.properties) {
          const target = targets[key];
          if (target === undefined || prop.measure) continue;
          if (prop.kind === "color") {
            if (target !== before[key]) properties.push({ key, delta: -1, ...timing(program, configuration.paths, event, key, undefined, undefined, t0) });
            continue;
          }
          const delta = Math.abs((target as number) - (before[key] as number));
          if (delta === 0) continue;
          properties.push({ key, delta, ...timing(program, configuration.paths, event, key, before[key] as number, target as number, t0) });
        }
        out.push({ from: path, event, to, path: ptr, properties });
      }
    }
  }
  return out;
}

/**
 * Plays the event again on a fresh runtime: when `key` is 90% of the way there, and when
 * it is done as far as a person can see (it stays within a pixel, or 0.5% of scale or
 * opacity, of where it ends up). The runtime's own rest threshold is far finer than that.
 */
function timing(program: Program, paths: string[], event: string, key: string, from: number | undefined, to: number | undefined, t0: number): { t90: number; settle: number } {
  const rt = createRuntime(program, { state: paths });
  rt.send(event, t0);
  const prop = key.split(".")[1];
  const color = program.properties.get(key)?.kind === "color";
  const eps = FRACTIONAL.has(prop) ? 0.005 : 0.5;
  let t90 = from === undefined || to === undefined ? NaN : HORIZON;
  let lastAway = t0;
  let t = t0;
  for (; t <= t0 + HORIZON + 1e-9; t += SCAN) {
    const v = rt.sample(t)[key];
    if (!color && to !== undefined && from !== undefined) {
      const d = Math.abs((v as number) - to);
      if (d > eps) lastAway = t;
      if (t90 === HORIZON && Math.abs((v as number) - from) >= 0.9 * Math.abs(to - from)) t90 = t - t0;
    }
    if (rt.settled(t, key)) break;
  }
  return { t90, settle: color ? t - t0 : Math.min(HORIZON, lastAway + SCAN - t0) };
}

function initialPath(program: Program): string | undefined {
  const m = program.machine;
  return m.kind === "states" ? m.initial : undefined;
}

type StatesMachine = Machine & { kind: "states" };
type LeafState = { path: string; pointer: string; state: State; machine: StatesMachine };
type StateConfiguration = { paths: string[]; leaves: LeafState[] };

function stateConfigurations(machine: Machine, prefix: string, pointer: string): StateConfiguration[] {
  if (machine.kind === "regions") {
    let combinations: StateConfiguration[] = [{ paths: [], leaves: [] }];
    for (const [name, region] of machine.regions) {
      const regionPrefix = prefix ? `${prefix}/${name}` : name;
      const configurations = stateConfigurations(region, regionPrefix, `${pointer}/regions/${escape(name)}`);
      combinations = combinations.flatMap((left) => configurations.map((right) => ({ paths: [...left.paths, ...right.paths], leaves: [...left.leaves, ...right.leaves] })));
    }
    return combinations;
  }
  const out: StateConfiguration[] = [];
  for (const [name, state] of machine.states) {
    const path = prefix ? `${prefix}/${name}` : name;
    const ptr = `${pointer}/states/${escape(name)}`;
    if (state.machine) out.push(...stateConfigurations(state.machine, path, ptr));
    else out.push({ paths: [path], leaves: [{ path, pointer: ptr, state, machine }] });
  }
  return out;
}

function forEachState(machine: Machine, pointer: string, visit: (state: State, pointer: string) => void) {
  if (machine.kind === "regions") {
    for (const [name, region] of machine.regions) forEachState(region, `${pointer}/regions/${escape(name)}`, visit);
    return;
  }
  for (const [name, state] of machine.states) {
    const ptr = `${pointer}/states/${escape(name)}`;
    visit(state, ptr);
    if (state.machine) forEachState(state.machine, ptr, visit);
  }
}

function escape(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}
