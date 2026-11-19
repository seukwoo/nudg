// `nudg to-css`, tier 1: a file as plain CSS, for pages that run no JavaScript. Each state is a
// rule under a selector the page already toggles (or hover, press and focus, read from the
// file's events); transitions carry each motion (a tween as cubic-bezier(), a spring as
// linear() sampled from its closed form); a state the element mounts into starts from
// @starting-style. Colors are written in oklab(), so CSS blends them as nudg does. Then the
// CSS is played against nudg's runtime, edge by edge, and what differs or can't be written is
// reported, not hidden. Drags, inputs, timers, kicks and loops are tiers 2 and 3.

import { createRuntime, type Value } from "./runtime.ts";
import { programToJson } from "./program-json.ts";
import { hexToOklab } from "./color.ts";
import { easeAt } from "./ease.ts";
import { springAt } from "./spring.ts";
import type { Channels, Machine, Motion, Program, State, Transition } from "./types.ts";

export interface ToCssOptions {
  /** A CSS selector per target; default `[data-nudg="<target>"]`. */
  targets?: Record<string, string>;
  /**
   * A selector per state, by leaf name or path, that matches when the state is active: a class
   * or attribute the page toggles, on the element or an ancestor (`[data-closing]`). Default:
   * `:hover`, `:active` or `:focus` when the file enters the state on hover, press or focus,
   * else `[data-nudg-state~="<name>"]`.
   */
  states?: Record<string, string>;
  /** An event the element is shown with as it mounts (an adapter's `start`): its way in plays from @starting-style. */
  mount?: string;
  /**
   * Also write a script (tier 3) that plays the file on nudg's runtime, exactly, where the
   * page runs JavaScript: the URLs of nudg's DOM player and program reader to import. The CSS
   * then applies only while the script hasn't started, as the page's fallback without it.
   */
  script?: { player: string; programs: string };
  /** The file's name, for the header comment. */
  file?: string;
}

export interface CssDifference {
  /** "closed → open". */
  edge: string;
  property: string;
  /** Largest difference, in the property's units (px, degrees, a factor, ΔE in OKLab). */
  max: number;
  /** Seconds after the change. */
  at: number;
}

export interface CssResult {
  /** The CSS, or "" when nothing could be written. */
  css: string;
  /** Edges compared, and where CSS moves differently (within the limits is not listed). */
  edges: number;
  differences: CssDifference[];
  /** What the page won't have without a script, one line each. */
  lost: string[];
  /** What the person should know: the selectors chosen, what to toggle. */
  notes: string[];
  /** The script (tier 3), when asked for: an ES module to load with <script type="module">. */
  script?: string;
  /** Why nothing was written, when that is so. */
  problems: string[];
}

/** The same limits as from-css. */
const LIMIT = { length: 0.5, rotation: 0.5, number: 0.01, color: 0.01 };
const SIZE_A = { width: 320, height: 240 };
const SIZE_B = { width: 410, height: 290 };
const SAMPLES = 60;
const SCROLL = /^([A-Za-z][\w-]*)\.scroll\.(x|y)$/;

type Kind = "length" | "rotation" | "number" | "color";
/** A value as CSS writes it: a number plus shares of the element's own width and height (for translate), or a color. */
interface CssValue {
  n: number;
  w: number;
  h: number;
  color?: Channels;
}
interface Timing {
  duration: number;
  delay: number;
  easing: string;
  /** Progress, 0 to 1 (a spring overshoots), `s` seconds after the change. */
  at(s: number): number;
}

interface Region {
  /** "" for a top-level machine, else the region name. */
  name: string;
  machine: Extract<Machine, { kind: "states" }>;
}

export function toCss(program: Program, options: ToCssOptions = {}): CssResult {
  const lost: string[] = [];
  const notes: string[] = [];
  const problems: string[] = [];
  const differences: CssDifference[] = [];
  const empty = (): CssResult => ({ css: "", edges: 0, differences: [], lost, notes, problems });

  const regions: Region[] = [];
  if (program.machine.kind === "states") regions.push({ name: "", machine: program.machine });
  else {
    for (const [name, m] of program.machine.regions) {
      if (m.kind === "states") regions.push({ name, machine: m });
      else problems.push(`Region "${name}" holds regions of its own; CSS states are one level deep.`);
    }
  }
  for (const r of regions) for (const s of r.machine.states.values()) if (s.machine) problems.push(`State "${pathOf(r, s.name)}" has states inside it; CSS states are one level deep. Flatten it, or keep this file on nudg's runtime.`);
  if (problems.length) return empty();

  // What CSS can't do, said once each.
  const unsupported = new Set<string>();
  for (const r of regions) {
    for (const s of r.machine.states.values()) {
      const where = pathOf(r, s.name);
      if (s.follow.size) unsupported.add(`${where} follows an input (a drag): tier 2 (scroll-snap) or a script.`);
      if (s.glide.size) unsupported.add(`${where} glides: a script.`);
      if (s.input.size) unsupported.add(`${where} sets a value from an input: a script.`);
      if (s.enter.size) unsupported.add(`${where} has an entry effect (a kick or keyframes): not in CSS yet.`);
      if (s.loop.size) unsupported.add(`${where} loops: not in CSS yet.`);
      if (s.timers.length) unsupported.add(`${where} has a timer: a page without a script can't change state on its own.`);
      if (s.cues?.length || [...s.when.values()].some((t) => t.cues?.length)) unsupported.add(`${where}: sounds and haptics need a script.`);
      if (s.emit?.length || [...s.when.values()].some((t) => t.emit?.length)) unsupported.add(`${where}: particles need a script.`);
      for (const t of s.when.values()) if (t.nearest) unsupported.add(`${where} settles on the nearest state: tier 2 (scroll-snap) or a script.`);
      for (const t of s.when.values()) if (t.step || t.commit) unsupported.add(`${where} steps or commits a value: a script.`);
    }
  }
  // A map from a scroll offset is a scroll-driven animation (tier 2); from any other input, a script.
  const scrollMaps = new Map<string, string[]>();
  for (const [key, prop] of program.properties) {
    if (prop.map?.sourceKind !== "input") continue;
    const scroll = SCROLL.exec(prop.map.source);
    if (scroll && prop.map.from.every((p) => typeof p === "number")) scrollMaps.set(prop.map.source, [...(scrollMaps.get(prop.map.source) ?? []), key]);
    else unsupported.add(`${key} is mapped from ${scroll ? "a measured scroll range" : "an input"}: a script.`);
  }
  for (const [key, m] of program.animate) if (m.delayInput) unsupported.add(`${key}'s delay reads an app input: a script, or a --i custom property per element.`);
  lost.push(...unsupported);

  // The layout a file measures, at two sizes, so a value that depends on its own size is found.
  const rt0 = createRuntime(program);
  const measures = rt0.measurements();
  const layout = (size: { width: number; height: number }, vary?: { target: string; of: "width" | "height" }) => {
    const out: [string, number][] = [];
    for (const name of measures) {
      const [target, , of] = name.split(".");
      let v = of === "x" || of === "y" ? 0 : of.toLowerCase().includes("height") ? size.height : size.width;
      if (vary && vary.target === target && (of === vary.of || of === `natural${vary.of[0].toUpperCase()}${vary.of.slice(1)}`)) v += vary.of === "width" ? 90 : 50;
      out.push([name, v]);
    }
    return out;
  };
  const settledAt = (paths: string[], lay: [string, number][]) => {
    const rt = createRuntime(program, { state: paths });
    for (const [n, v] of lay) rt.input(n, v, 0);
    return rt.sample(0);
  };

  // Rest states: the initial ones, or where the mount event leads.
  const initialPaths = rt0.state();
  let restPaths = initialPaths;
  if (options.mount) {
    const rt = createRuntime(program);
    if (!rt.send(options.mount, 0)) {
      problems.push(`The file doesn't handle ${options.mount} in its starting state, so it can't mount with it.`);
      return empty();
    }
    restPaths = rt.state();
  }
  const restOf = (r: Region) => restPaths.find((p) => regionOf(p) === r.name)!;

  // Each state's values: the state itself, with every other region at rest.
  const pathsWith = (r: Region, state: string) => restPaths.map((p) => (regionOf(p) === r.name ? pathOf(r, state) : p));
  const kindOf = (key: string): Kind => {
    const name = key.split(".").slice(1).join(".");
    if (program.properties.get(key)!.kind === "color") return "color";
    if (name === "rotation") return "rotation";
    return program.properties.get(key)!.kind === "length" ? "length" : "number";
  };
  const cssValues = (paths: string[]): Map<string, CssValue> | string => {
    const a = settledAt(paths, layout(SIZE_A));
    const out = new Map<string, CssValue>();
    for (const [key, value] of Object.entries(a)) {
      if (typeof value === "string") {
        out.set(key, { n: 0, w: 0, h: 0, color: hexToOklab(value) });
        continue;
      }
      const v: CssValue = { n: value, w: 0, h: 0 };
      const [target, prop] = key.split(".");
      for (const dim of ["width", "height"] as const) {
        for (const t of program.targets) {
          const b = settledAt(paths, layout(SIZE_A, { target: t, of: dim }))[key] as number;
          const d = b - value;
          if (Math.abs(d) < 1e-9) continue;
          const own = t === target && ((prop === "x" && dim === "width") || (prop === "y" && dim === "height"));
          if (!own) return `${key} depends on ${t}'s measured ${dim}. Plain CSS can only take x from an element's own width and y from its own height (translate's percentages); this needs a script, so keep the file on nudg's runtime.`;
          v.w += dim === "width" ? d / 90 : 0;
          v.h += dim === "height" ? d / 50 : 0;
        }
      }
      v.n = value - v.w * SIZE_A.width - v.h * SIZE_A.height;
      out.set(key, v);
    }
    return out;
  };

  // Values per region state.
  const values = new Map<string, Map<string, CssValue>>();
  for (const r of regions) {
    for (const name of r.machine.states.keys()) {
      const v = cssValues(pathsWith(r, name));
      if (typeof v === "string") {
        problems.push(v);
        return empty();
      }
      values.set(pathOf(r, name), v);
    }
  }
  const initialValues = cssValues(initialPaths);
  if (typeof initialValues === "string") {
    problems.push(initialValues);
    return empty();
  }
  // Which region moves each property: the one whose states give it different values.
  const owner = new Map<string, Region>();
  for (const r of regions) {
    const states = [...r.machine.states.keys()].map((n) => values.get(pathOf(r, n))!);
    for (const key of program.properties.keys()) {
      if (states.some((s) => !sameValue(s.get(key)!, states[0].get(key)!))) {
        if (owner.has(key)) {
          problems.push(`${key} changes in two regions; nudg forbids that, so this file isn't valid.`);
          return empty();
        }
        owner.set(key, r);
      }
    }
  }

  // Selectors.
  const selectorOf = (target: string) => options.targets?.[target] ?? `[data-nudg="${target}"]`;
  const conditions = new Map<string, { selector: string; on: "self" | string }>();
  for (const r of regions) {
    const pseudo = pseudoStates(r.machine);
    for (const name of r.machine.states.keys()) {
      const path = pathOf(r, name);
      if (path === restOf(r)) continue;
      const given = options.states?.[path] ?? options.states?.[name];
      if (given) conditions.set(path, { selector: given, on: "self" });
      else if (pseudo.has(name)) conditions.set(path, pseudo.get(name)!);
      else {
        conditions.set(path, { selector: `[data-nudg-state~="${name}"]`, on: "self" });
        const on = [...new Set([...r.machine.states.values(), { when: r.machine.when } as State].flatMap((st) => [...st.when].filter(([, t]) => t.to === name).map(([e]) => e)))];
        notes.push(`${path}: set data-nudg-state="${name}" on the element or an ancestor while it is active${on.length ? ` (the file enters it on ${on.join(", ")})` : ""}, or pass --state ${name}=<selector>.`);
      }
    }
  }
  const ruleSelector = (target: string, path: string) => {
    const sel = selectorOf(target);
    const c = conditions.get(path)!;
    if (c.on !== "self") {
      const host = `${selectorOf(c.on)}${c.selector}`;
      return c.on === target ? host : `${host} ${sel}`;
    }
    return `:is(${c.selector}) ${sel}, ${sel}:is(${c.selector})`;
  };

  // Timing into each state, per property, from every edge that enters it.
  const edges: { region: Region; from: string; to: string; event: string; transition: Transition }[] = [];
  for (const r of regions) {
    for (const s of r.machine.states.values()) {
      for (const [event, t] of [...s.when, ...r.machine.when]) {
        if (!t.to || t.nearest || t.to === s.name) continue;
        edges.push({ region: r, from: pathOf(r, s.name), to: pathOf(r, t.to), event, transition: t });
      }
    }
  }
  const motionOf = (key: string, t: Transition): Motion | undefined => {
    const source = program.properties.get(key)!.map?.source ?? key;
    return t.animate.get(source) ?? program.animate.get(source);
  };
  const timings = new Map<string, Map<string, Timing>>();
  const timingKey = new Map<string, string>();
  const travel = (key: string) => {
    let max = 0;
    const r = owner.get(key);
    if (!r) return 0;
    const all = [...r.machine.states.keys()].map((n) => values.get(pathOf(r, n))!.get(key)!);
    for (const a of all) for (const b of all) max = Math.max(max, distance(a, b));
    return max;
  };
  for (const e of edges) {
    const into = timings.get(e.to) ?? new Map<string, Timing>();
    for (const key of program.properties.keys()) {
      if (owner.get(key) !== e.region) continue;
      const m = motionOf(key, e.transition);
      if (m?.delayInput) continue;
      const timing = timingFor(m, travel(key), kindOf(key));
      const id = `${e.to} ${key}`;
      if (!into.has(key)) {
        into.set(key, timing);
        timingKey.set(id, `${timing.duration} ${timing.delay} ${timing.easing}`);
      } else if (timingKey.get(id) !== `${timing.duration} ${timing.delay} ${timing.easing}`) {
        lost.push(`${key} moves into ${e.to} differently from ${e.from}; CSS takes one timing per state (the comparison shows how far it differs).`);
      }
    }
    timings.set(e.to, into);
  }

  // Rules. With a script, each applies only until the script starts (it marks <html>).
  const scope = (selector: string) => (options.script ? splitSelectors(selector).map((x) => `:root:not([data-nudg-live]) ${x}`).join(", ") : selector);
  const header = `/* Generated by nudg${options.file ? ` from ${options.file}` : ""}. Edit the nudg file and run nudg to-css again; hand edits are lost. */`;
  const out: string[] = [header];
  const byTarget = new Map<string, string[]>();
  for (const key of program.properties.keys()) {
    const target = key.split(".")[0];
    byTarget.set(target, [...(byTarget.get(target) ?? []), key]);
  }
  const customs = [...program.properties.keys()].filter((k) => k.includes(".custom."));
  for (const name of new Set(customs.map((k) => k.split(".custom.")[1]))) out.push(`@property --nudg-${name} { syntax: "<number>"; inherits: false; initial-value: 0; }`);

  const restValues = new Map<string, CssValue>();
  for (const r of regions) for (const [k, v] of values.get(restOf(r))!) if (!owner.has(k) || owner.get(k) === r) restValues.set(k, v);
  const reducedRules: string[] = [];
  for (const [target, keys] of byTarget) {
    const sel = selectorOf(target);
    const restTimings = new Map<string, Timing>();
    for (const r of regions) for (const [k, t] of timings.get(restOf(r)) ?? []) restTimings.set(k, t);
    const decls = declarations(target, keys, restValues);
    const trans = transitionList(keys, restTimings);
    // A rule that declares `transition` replaces the whole list, so a state rule lists every
    // property of the element; when each property moves the same way into every state, the
    // element's own rule says it once.
    const uniform = keys.every((k) => {
      const r = owner.get(k);
      if (!r) return true;
      const ids = [...r.machine.states.keys()].map((n) => timingKey.get(`${pathOf(r, n)} ${k}`)).filter((x) => x !== undefined);
      return new Set(ids).size <= 1;
    });
    const regionsHere = new Set(keys.map((k) => owner.get(k)).filter(Boolean));
    if (!uniform && regionsHere.size > 1) lost.push(`${target}'s properties change in ${regionsHere.size} regions with timings that depend on the state; CSS keeps one transition list per rule, so when two of them change at once one may take the other's timing.`);
    out.push(rule(scope(sel), [...decls, ...(trans ? [`transition: ${trans}`] : [])]));
    if (options.mount && keys.some((k) => !sameValue(initialValues.get(k)!, restValues.get(k)!))) {
      out.push(`@starting-style {\n  ${rule(scope(sel), declarations(target, keys, initialValues)).replace(/\n/g, "\n  ")}\n}`);
    }
    if (trans) reducedRules.push(sel);
    for (const r of regions) {
      const owned = keys.filter((k) => owner.get(k) === r);
      if (!owned.length) continue;
      for (const name of r.machine.states.keys()) {
        const path = pathOf(r, name);
        if (path === restOf(r)) continue;
        const v = values.get(path)!;
        const into = new Map(restTimings);
        for (const [k, t] of timings.get(path) ?? []) into.set(k, t);
        const t = uniform ? "" : transitionList(keys, into);
        out.push(rule(scope(ruleSelector(target, path)), [...declarations(target, owned, v), ...(t ? [`transition: ${t}`] : [])]));
      }
    }
  }
  // Tier 2: maps from a scroll offset play on the scroller's own timeline.
  const scrollTimelines: string[] = [];
  const scrollRules: string[] = [];
  for (const [source, keys] of scrollMaps) {
    const [, scroller, axis] = SCROLL.exec(source)!;
    const timeline = `--nudg-${scroller}-${axis}`;
    scrollTimelines.push(timeline);
    out.push(rule(selectorOf(scroller), [`scroll-timeline: ${timeline} ${axis === "y" ? "block" : "inline"}`]));
    const points = [...new Set(keys.flatMap((k) => program.properties.get(k)!.map!.from as number[]))].sort((a, b) => a - b);
    const [lo, hi] = [points[0], points[points.length - 1]];
    const at = (offset: number) => {
      const rt = createRuntime(program);
      rt.input(source, offset, 0);
      const sample = rt.sample(0);
      return new Map(keys.map((k) => [k, typeof sample[k] === "string" ? { n: 0, w: 0, h: 0, color: hexToOklab(sample[k] as string) } : { n: sample[k] as number, w: 0, h: 0 }]));
    };
    for (const target of new Set(keys.map((k) => k.split(".")[0]))) {
      const mine = keys.filter((k) => k.split(".")[0] === target);
      const name = `nudg-${target}-${scroller}-${axis}`;
      const frames = points.map((p) => `  ${fmt(hi === lo ? 100 : ((p - lo) / (hi - lo)) * 100)}% { ${declarations(target, mine, at(p)).join("; ")}; }`);
      out.push(`@keyframes ${name} {\n${frames.join("\n")}\n}`);
      scrollRules.push(rule(scope(selectorOf(target)), [`animation: ${name} linear both`, `animation-timeline: ${timeline}`, `animation-range: ${fmt(lo)}px ${fmt(hi)}px`]));
      // The proof: a map is linear between its points, as keyframes are.
      for (let i = 0; i <= SAMPLES; i++) {
        const offset = lo - (hi - lo) * 0.1 + ((hi - lo) * 1.2 * i) / SAMPLES;
        const nudg = at(offset);
        // CSS holds the first and last keyframes outside the range (fill: both), and is linear between keyframes.
        const x = Math.min(hi, Math.max(lo, offset));
        let j = 0;
        while (j < points.length - 2 && x > points[j + 1]) j++;
        const a = at(points[j]);
        const b = at(points[Math.min(j + 1, points.length - 1)]);
        const local = points.length < 2 ? 1 : (x - points[j]) / (points[j + 1] - points[j]);
        for (const k of mine) {
          const va = a.get(k)!;
          const vb = b.get(k)!;
          const want = nudg.get(k)!;
          const d = va.color ? Math.hypot(...va.color.map((c, n) => c + (vb.color![n] - c) * local - want.color![n])) : Math.abs(va.n + (vb.n - va.n) * local - want.n);
          if (d > LIMIT[kindOf(k)] && !differences.some((x) => x.property === k)) differences.push({ edge: `scrolling ${source} to ${fmt(offset)}`, property: k, max: d, at: 0 });
        }
      }
    }
  }
  if (scrollRules.length) {
    out.push(rule(":root", [`timeline-scope: ${scrollTimelines.join(", ")}`]));
    out.push(`@supports (animation-timeline: scroll()) {\n  ${scrollRules.map((r) => r.replace(/\n/g, "\n  ")).join("\n\n  ")}\n}`);
    notes.push("Values that follow the scroll use scroll-driven animations (Chrome 115, Safari 26). Where those aren't supported, they stay as at the top.");
  }
  if (reducedRules.length) out.push(`@media (prefers-reduced-motion: reduce) {\n  ${rule(scope(reducedRules.join(", ")), ["transition-duration: 0.15s !important", "transition-timing-function: linear !important", "transition-delay: 0s !important"]).replace(/\n/g, "\n  ")}\n}`);
  if (options.mount) notes.push(`The way in plays as the element mounts (@starting-style: Chrome 117, Safari 17.5, Firefox 129). Before those, it appears in place.`);

  // The proof: every edge (and the mount), nudg's runtime against the CSS's own timing.
  const restTimingsAll = new Map<string, Timing>();
  for (const r of regions) for (const [k, t] of timings.get(restOf(r)) ?? []) restTimingsAll.set(k, t);
  const proofEdges: { label: string; labelFrom: string; fromPaths: string[]; event: string; into: string; region?: Region }[] = edges.map((e) => ({ label: `${e.from} → ${e.to}`, labelFrom: e.from, fromPaths: pathsWith(e.region, stateName(e.from)), event: e.event, into: e.to, region: e.region }));
  if (options.mount) proofEdges.push({ label: `mount (${options.mount})`, labelFrom: "", fromPaths: initialPaths, event: options.mount, into: "" });
  for (const e of proofEdges) {
    for (const size of [SIZE_A, SIZE_B]) {
      const rt = createRuntime(program, { state: e.fromPaths });
      for (const [n, v] of layout(size)) rt.input(n, v, 0);
      const before = rt.state();
      rt.send(e.event, 0);
      const after = rt.state();
      // The CSS side reads only what the CSS says: each region's state before and after (one
      // event may change several, and the page toggles each), the values written in their
      // rules, resolved at this size, and the timing the destination rule declares.
      const pathIn = (paths: string[], r: Region) => paths.find((p) => regionOf(p) === r.name)!;
      const cssValue = (key: string, when: "start" | "end"): Value => {
        const r = owner.get(key);
        const v = r ? values.get(pathIn(when === "start" ? before : after, r))!.get(key)! : restValues.get(key)!;
        return v.color ? (v.color as unknown as Value) : v.n + v.w * size.width + v.h * size.height;
      };
      let horizon = 0;
      const timingOf = (key: string): Timing | undefined => {
        const r = owner.get(key);
        if (!r) return undefined;
        const into = pathIn(after, r);
        if (into === pathIn(before, r)) return undefined;
        const target = key.split(".")[0];
        return declaredTimings([...program.properties.keys()].filter((k) => k.startsWith(`${target}.`)), new Map([...restTimingsAll, ...(timings.get(into) ?? new Map())])).get(key);
      };
      for (const key of program.properties.keys()) {
        const t = timingOf(key);
        if (t) horizon = Math.max(horizon, t.delay + t.duration);
      }
      horizon = Math.max(horizon, 0.05);
      // What the page loses anyway (listed above) isn't compared: an entry effect, a loop, a drag.
      const states = [e.fromPaths, createRuntime(program, { state: e.fromPaths }).state()];
      const skip = new Set<string>();
      {
        const probe = createRuntime(program, { state: e.fromPaths });
        probe.send(e.event, 0);
        states.push(probe.state());
      }
      for (const paths of states) for (const path of paths) {
        const r = regions.find((x) => x.name === regionOf(path));
        const st = r?.machine.states.get(r.name ? stateName(path) : path);
        if (!st) continue;
        for (const m of [st.enter, st.loop, st.follow, st.glide, st.input]) for (const k of m.keys()) skip.add(k);
      }
      for (const [k, prop] of program.properties) if (prop.map && skip.has(prop.map.source)) skip.add(k);
      const worst = new Map<string, CssDifference>();
      for (let i = 1; i <= SAMPLES; i++) {
        const s = (horizon * i) / SAMPLES;
        const nudg = rt.sample(s);
        for (const key of program.properties.keys()) {
          if (key.includes(".custom.") || skip.has(key)) continue;
          const a = cssValue(key, "start");
          const b = cssValue(key, "end");
          const t = timingOf(key);
          const css = cssAt(a, b, t, s);
          const d = valueDiff(nudg[key], css);
          const kind = kindOf(key);
          if (d > LIMIT[kind] && d > (worst.get(key)?.max ?? 0)) worst.set(key, { edge: e.label, property: key, max: d, at: s });
        }
      }
      for (const w of worst.values()) if (!differences.some((x) => x.edge === w.edge && x.property === w.property)) differences.push(w);
    }
  }
  let script: string | undefined;
  if (options.script) {
    script = writeScript(program, options, selectorOf, regions.map((r) => ({ name: r.name, rest: restOf(r), conditions: [...r.machine.states.keys()].map((n) => pathOf(r, n)).filter((p) => conditions.get(p)?.on === "self" && !conditions.get(p)!.selector.startsWith("[data-nudg-state")).map((p) => [p, conditions.get(p)!.selector] as [string, string]) })));
    notes.push(
      "With the script, the page plays the file on nudg's runtime, exactly, and everything listed above as lost comes back; the CSS applies only where the script doesn't run. Load both, and mark <html> before the CSS paints so it doesn't play first:",
      `  <script>document.documentElement.setAttribute("data-nudg-live", "")</script>`,
      `  <script type="module" src="${(options.file ?? "motion.nudg.json").replace(/\.nudg\.json$/, "")}.nudg.js"></script>`,
    );
  }
  return { css: out.join("\n\n") + "\n", ...(script ? { script } : {}), edges: proofEdges.length + scrollMaps.size, differences, lost: [...new Set(lost)], notes, problems };
}

/** The CSS value `s` seconds after a change from `a` to `b` (numbers, or OKLab channels) with timing `t` (none: it jumps). */
function cssAt(a: Value, b: Value, t: Timing | undefined, s: number): Value {
  const p = !t ? 1 : s < t.delay ? 0 : s >= t.delay + t.duration ? 1 : t.at(s - t.delay);
  if (typeof a === "number" && typeof b === "number") return a + (b - a) * p;
  const ca = a as unknown as Channels;
  const cb = b as unknown as Channels;
  return ca.map((c, i) => c + (cb[i] - c) * p) as unknown as Value;
}

function valueDiff(nudg: Value, css: Value): number {
  if (typeof nudg === "number") return Math.abs(nudg - (css as number));
  const a = hexToOklab(nudg);
  const b = css as unknown as Channels;
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3]);
}

/** A motion as a CSS transition timing. Springs become linear() with enough points to stay within the limit over `travel`. */
function timingFor(m: Motion | undefined, travel: number, kind: Kind): Timing {
  if (!m) return { duration: 0, delay: 0, easing: "linear", at: () => 1 };
  const delay = m.delay ?? 0;
  if (m.kind === "tween") {
    const ease = m.ease;
    return { duration: m.duration, delay, easing: ease === "linear" ? "linear" : `cubic-bezier(${ease.map(fmt).join(", ")})`, at: (s) => easeAt(ease, s / m.duration) };
  }
  const progress = (s: number) => 1 - springAt(m, 1, 0, s)[0];
  // Long enough that what is left of the motion is under a quarter of the limit.
  const tol = LIMIT[kind] / 4 / Math.max(travel, 1e-6);
  let duration = 0.05;
  for (let s = 0.01; s < 10; s += 0.01) {
    const [x, v] = springAt(m, 1, 0, s);
    duration = s;
    if (Math.abs(x) < tol && Math.abs(v) * Math.sqrt(m.mass / m.stiffness) < tol) break;
  }
  duration = Math.round(duration * 1000) / 1000;
  // Points until the polyline is within a quarter of the limit, checked between points.
  let n = 8;
  let points: number[] = [];
  for (; n <= 256; n *= 2) {
    points = Array.from({ length: n + 1 }, (_, i) => (i === n ? 1 : progress((duration * i) / n)));
    let worst = 0;
    for (let i = 0; i < n * 4; i++) {
      const s = (duration * (i + 0.5)) / (n * 4);
      worst = Math.max(worst, Math.abs(polyline(points, s / duration) - progress(s)));
    }
    if (worst * travel < LIMIT[kind] / 4) break;
  }
  const rounded = points.map((p) => Math.round(p * 10000) / 10000);
  return { duration, delay, easing: `linear(${rounded.map(fmt).join(", ")})`, at: (s) => polyline(rounded, s / duration) };
}

function polyline(points: number[], u: number): number {
  if (u <= 0) return points[0];
  if (u >= 1) return points[points.length - 1];
  const x = u * (points.length - 1);
  const i = Math.floor(x);
  return points[i] + (points[i + 1] - points[i]) * (x - i);
}

/** States a region enters on hover, press or focus of a target and leaves on its end: a pseudo-class. */
function pseudoStates(machine: Extract<Machine, { kind: "states" }>): Map<string, { selector: string; on: string }> {
  const out = new Map<string, { selector: string; on: string }>();
  const pairs: [string, string[], string][] = [["hoverstart", ["hoverend"], ":hover"], ["down", ["up", "cancel"], ":active"], ["focus", ["blur"], ":focus"]];
  const states = [...machine.states.values()];
  if (states.length !== 2) return out;
  for (const [a, b] of [states, [...states].reverse()]) {
    for (const [start, ends, pseudo] of pairs) {
      const enter = [...a.when].find(([e, t]) => e.endsWith(`.${start}`) && t.to === b.name);
      if (!enter) continue;
      const target = enter[0].split(".")[0];
      const leaves = [...b.when].filter(([, t]) => t.to === a.name).map(([e]) => e);
      const entersOther = [...a.when].filter(([, t]) => t.to === b.name).map(([e]) => e);
      if (entersOther.length === 1 && leaves.length > 0 && leaves.every((e) => ends.some((end) => e === `${target}.${end}`))) out.set(b.name, { selector: pseudo, on: target });
    }
  }
  return out;
}

function declarations(target: string, keys: string[], v: Map<string, CssValue>): string[] {
  const get = (name: string) => v.get(`${target}.${name}`);
  const has = (name: string) => keys.includes(`${target}.${name}`);
  const out: string[] = [];
  if (has("x") || has("y")) out.push(`translate: ${length(get("x"))} ${length(get("y"))}`);
  if (has("rotation")) out.push(`rotate: ${fmt(get("rotation")!.n)}deg`);
  if (has("scale") || has("scaleX") || has("scaleY")) {
    const s = get("scale")?.n ?? 1;
    const sx = s * (get("scaleX")?.n ?? 1);
    const sy = s * (get("scaleY")?.n ?? 1);
    out.push(`scale: ${sx === sy ? fmt(sx) : `${fmt(sx)} ${fmt(sy)}`}`);
  }
  if (has("opacity")) out.push(`opacity: ${fmt(get("opacity")!.n)}`);
  if (has("width")) out.push(`width: ${length(get("width"))}`);
  if (has("height")) out.push(`height: ${length(get("height"))}`);
  if (has("color")) out.push(`background-color: ${oklab(get("color")!.color!)}`);
  const shadows: string[] = [];
  if (["shadowX", "shadowY", "shadowBlur", "shadowSpread", "shadowColor"].some(has)) {
    shadows.push(`${length(get("shadowX"))} ${length(get("shadowY"))} ${length(get("shadowBlur"))} ${length(get("shadowSpread"))} ${oklab(get("shadowColor")?.color ?? hexToOklab("#00000040"))}`);
  }
  if (["innerX", "innerY", "innerBlur", "innerSpread", "innerColor"].some(has)) {
    shadows.push(`inset ${length(get("innerX"))} ${length(get("innerY"))} ${length(get("innerBlur"))} ${length(get("innerSpread"))} ${oklab(get("innerColor")?.color ?? hexToOklab("#00000040"))}`);
  }
  if (shadows.length) out.push(`box-shadow: ${shadows.join(", ")}`);
  if (has("blur")) out.push(`filter: blur(${length(get("blur"))})`);
  for (const key of keys) if (key.startsWith(`${target}.custom.`)) out.push(`--nudg-${key.split(".custom.")[1]}: ${fmt(v.get(key)!.n)}`);
  return out;
}

/** The CSS properties a file's properties are written to, for `transition`. */
function cssProperty(key: string): string {
  const name = key.split(".").slice(1).join(".");
  if (name === "x" || name === "y") return "translate";
  if (name === "rotation") return "rotate";
  if (name.startsWith("scale")) return "scale";
  if (name === "color") return "background-color";
  if (name.startsWith("shadow") || name.startsWith("inner")) return "box-shadow";
  if (name === "blur") return "filter";
  if (name.startsWith("custom.")) return `--nudg-${name.slice(7)}`;
  return name;
}

/** The timing each CSS property gets: properties written to one CSS property share it; the proof reports the rest. */
function byCssProperty(keys: string[], timings: Map<string, Timing>): Map<string, Timing> {
  const by = new Map<string, Timing>();
  for (const key of keys) {
    const t = timings.get(key);
    if (!t) continue;
    const prop = cssProperty(key);
    if (!by.has(prop) || t.duration + t.delay > by.get(prop)!.duration + by.get(prop)!.delay) by.set(prop, t);
  }
  return by;
}

/** Each file property's timing as the rule declares it. */
function declaredTimings(keys: string[], timings: Map<string, Timing>): Map<string, Timing> {
  const by = byCssProperty(keys, timings);
  const out = new Map<string, Timing>();
  for (const key of keys) {
    const t = by.get(cssProperty(key));
    if (t) out.set(key, t);
  }
  return out;
}

function transitionList(keys: string[], timings: Map<string, Timing>): string {
  return [...byCssProperty(keys, timings)].map(([p, t]) => `${p} ${fmt(t.duration)}s ${t.easing}${t.delay ? ` ${fmt(t.delay)}s` : ""}`).join(", ");
}

/** A selector list split at its top-level commas (not those inside :is()). */
function splitSelectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === "(") depth++;
    else if (list[i] === ")") depth--;
    else if (list[i] === "," && depth === 0) {
      out.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(list.slice(start).trim());
  return out;
}

/**
 * Tier 3: an ES module that plays the compiled file with nudg's DOM player, bound by the same
 * selectors. A state the page shows with a selector of its own (a class or attribute it
 * toggles) is followed: when one starts or stops matching, the script sends the event that
 * leads there, as the file says.
 */
function writeScript(program: Program, options: ToCssOptions, selectorOf: (t: string) => string, regions: { name: string; rest: string; conditions: [string, string][] }[]): string {
  const bind = Object.fromEntries(program.targets.map((t) => [t, selectorOf(t)]));
  // The attributes the page's selectors read; the player's own data-nudg-state isn't one.
  const attributes = [...new Set(["class", ...regions.flatMap((r) => r.conditions.flatMap(([, sel]) => [...sel.matchAll(/\[([\w-]+)/g)].map((m) => m[1])))])];
  const lines = [
    `// Generated by nudg${options.file ? ` from ${options.file}` : ""}: the file on nudg's runtime, exactly. Edit the nudg file and run nudg to-css --script again.`,
    `import { play } from ${JSON.stringify(options.script!.player)};`,
    `import { programFromJson } from ${JSON.stringify(options.script!.programs)};`,
    ``,
    `const program = programFromJson(${JSON.stringify(programToJson(program))});`,
    `const selectors = ${JSON.stringify(bind)};`,
    `const regions = ${JSON.stringify(regions)};`,
    ``,
    `document.documentElement.setAttribute("data-nudg-live", "");`,
    `const bind = Object.fromEntries(Object.entries(selectors).map(([t, s]) => [t, [...document.querySelectorAll(s)]]));`,
    `const player = play(program, null, { bind${options.mount ? `, start: ${JSON.stringify(options.mount)}` : ""} });`,
    ``,
    `// States the page shows with a class or attribute: follow them with the event the file goes there on.`,
    `const elements = Object.values(bind).flat();`,
    `const matches = (selector) => elements.some((el) => el.closest(selector));`,
    `const machineOf = (region) => (region ? program.machine.regions.get(region) : program.machine);`,
    `function follow() {`,
    `  for (const r of regions) {`,
    `    if (!r.conditions.length) continue;`,
    `    const want = r.conditions.find(([, s]) => matches(s))?.[0] ?? r.rest;`,
    `    const now = player.runtime.state().find((p) => (r.name ? p.startsWith(r.name + "/") : true));`,
    `    if (!now || now === want) continue;`,
    `    const machine = machineOf(r.name);`,
    `    const name = (p) => (r.name ? p.slice(r.name.length + 1) : p);`,
    `    const from = machine.states.get(name(now));`,
    `    const event = [...from.when, ...machine.when].find(([, t]) => t.to === name(want))?.[0];`,
    `    if (event) player.send(event);`,
    `  }`,
    `}`,
    `if (regions.some((r) => r.conditions.length)) {`,
    `  new MutationObserver(follow).observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ${JSON.stringify(attributes)} });`,
    `  follow();`,
    `}`,
    `export { player };`,
  ];
  return lines.join("\n") + "\n";
}

function rule(selector: string, decls: string[]): string {
  return `${selector} {\n${decls.map((d) => `  ${d};`).join("\n")}\n}`;
}

function length(v: CssValue | undefined): string {
  if (!v) return "0px";
  const parts: string[] = [];
  if (Math.abs(v.n) > 1e-6 || (!v.w && !v.h)) parts.push(`${fmt(v.n)}px`);
  if (v.w) parts.push(`${fmt(v.w * 100)}%`);
  if (v.h) parts.push(`${fmt(v.h * 100)}%`);
  return parts.length === 1 ? parts[0] : `calc(${parts.join(" + ")})`;
}

function oklab([L, a, b, alpha]: Channels): string {
  return `oklab(${fmt(L)} ${fmt(a)} ${fmt(b)}${alpha < 1 ? ` / ${fmt(alpha)}` : ""})`;
}

function fmt(n: number): string {
  const r = Math.round(n * 10000) / 10000;
  return String(Object.is(r, -0) ? 0 : r);
}

function sameValue(a: CssValue, b: CssValue): boolean {
  return distance(a, b) < 1e-9;
}

function distance(a: CssValue, b: CssValue): number {
  if (a.color && b.color) return Math.hypot(...a.color.map((c, i) => c - b.color![i]));
  return Math.abs(a.n - b.n) + Math.abs(a.w - b.w) * SIZE_A.width + Math.abs(a.h - b.h) * SIZE_A.height;
}

function pathOf(r: Region, state: string): string {
  return r.name ? `${r.name}/${state}` : state;
}

function regionOf(path: string): string {
  const i = path.indexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

function stateName(path: string): string {
  return path.slice(path.indexOf("/") + 1);
}

export function formatToCss(r: CssResult): string {
  const lines: string[] = [];
  if (r.problems.length) return ["Not written:", ...r.problems.map((p) => `  ${p}`)].join("\n");
  lines.push(r.differences.length ? `CSS moves differently from the file on ${r.differences.length} of the checked properties:` : `Written: ${r.edges} change${r.edges === 1 ? "" : "s"} of state or scroll checked against nudg's runtime at ${SAMPLES} points and two sizes; all within 0.5 px, 0.5°, 0.01.`);
  for (const d of r.differences) lines.push(`  ${d.edge}: ${d.property} differs by ${fmt(d.max)} at ${fmt(d.at)} s`);
  if (r.lost.length) lines.push("", "Without a script, the page won't have:", ...r.lost.map((l) => `  ${l}`));
  if (r.notes.length) lines.push("", ...r.notes);
  return lines.join("\n");
}

export type { State };
