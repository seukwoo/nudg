// CSS @keyframes in, a nudg file out, with proof that both move the same.
//
// The converter reads one @keyframes block and the animation line that plays it, writes a
// nudg document (entry keyframes for a one-off, a loop for an infinite animation), then
// samples the CSS animation and the compiled program at 60 points and reports the largest
// difference per property. Past the limits it writes nothing and names the reason: a
// converter that quietly approximates would move motion into nudg and change it on the way.
// Pure text in, document and report out: no Node or DOM APIs.

import { hexToOklab } from "./color.ts";
import { compile } from "./compile.ts";
import { easeAt } from "./ease.ts";
import { createRuntime } from "./runtime.ts";
import { fromDurationBounce, springAt } from "./spring.ts";
import type { Ease } from "./types.ts";
import { NAMED_EASES, VERSION } from "./vocabulary.ts";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

export interface FromCssOptions {
  /** The nudg target the element becomes, default "content" (what useNudgOnce binds). */
  target?: string;
  /** Overrides for the animation line, or the whole line when the source has none: "0.6s ease-out 2". */
  animation?: string;
  /** The element's box for the proof, when a value is a percentage of it. Default 120 × 48. */
  size?: [number, number];
}

export interface CssDifference {
  property: string;
  /** The largest difference over the samples, in the property's unit. */
  max: number;
  unit: "px" | "deg" | "" | "ΔE";
  /** When in the animation it is largest, in seconds. */
  at: number;
  limit: number;
}

export interface CssConversion {
  /** The nudg document, when the conversion is within the limits. */
  doc?: JsonObject;
  /** How to play it from the host. */
  play?: string;
  /** Per property, how far nudg is from the CSS. */
  differences: CssDifference[];
  /** Why the file wasn't written: each names the frame or value and what to do. */
  problems: string[];
  /** Assumptions and differences by design, true whether or not the file was written. */
  notes: string[];
  /** A spring that makes the same overshoot, offered beside the exact conversion; the person chooses. */
  spring?: { doc: JsonObject; properties: string[]; differences: CssDifference[]; summary: string };
}

/** Limits for an exact conversion. Colors: CSS blends in sRGB and nudg in OKLab, so they are a note, not a limit. */
const LIMITS: Record<string, number> = { px: 0.5, deg: 0.5, "": 0.01 };
const SAMPLES = 60;

const CSS_EASES: Record<string, Ease> = {
  linear: "linear",
  ease: [0.25, 0.1, 0.25, 1],
  "ease-in": [0.42, 0, 1, 1],
  "ease-out": [0, 0, 0.58, 1],
  "ease-in-out": [0.42, 0, 0.58, 1],
};

/** A nudg property and its value at one frame. Lengths may be a share of the element's own size. */
type Length = { px: number; width?: number; height?: number };
/** One CSS transform function, by its primitive: translate, rotate or scale. */
type Fn = { k: "t"; x: Length; y: Length } | { k: "r"; a: number } | { k: "s"; x: number; y: number };
type Part = "x" | "y" | "rotation" | "scale" | "scaleX" | "scaleY" | "shear";
/** A frame's transform list, read as one nudg property. CSS interpolates the list, not the parts. */
type TList = { fns: Fn[]; part: Part };
type Value = number | Length | string | TList;

interface Frame {
  at: number;
  values: Map<string, Value>;
  ease?: Ease;
}

interface Animation {
  duration: number;
  delay: number;
  ease: Ease;
  iterations: number;
  direction: "normal" | "reverse" | "alternate" | "alternate-reverse";
  fill: "none" | "forwards" | "backwards" | "both";
}

/** Kinds by nudg property: what unit a difference is in, and what the element's own value is. */
const KINDS: Record<string, { unit: CssDifference["unit"]; own: Value }> = {
  x: { unit: "px", own: 0 },
  y: { unit: "px", own: 0 },
  rotation: { unit: "deg", own: 0 },
  scale: { unit: "", own: 1 },
  scaleX: { unit: "", own: 1 },
  scaleY: { unit: "", own: 1 },
  opacity: { unit: "", own: 1 },
  width: { unit: "px", own: 0 },
  height: { unit: "px", own: 0 },
  blur: { unit: "px", own: 0 },
  shadowX: { unit: "px", own: 0 },
  shadowY: { unit: "px", own: 0 },
  shadowBlur: { unit: "px", own: 0 },
  shadowColor: { unit: "ΔE", own: "#00000000" },
  color: { unit: "ΔE", own: "" },
};

export function fromCss(source: string, name: string, options: FromCssOptions = {}): CssConversion {
  const problems: string[] = [];
  const notes: string[] = [];
  const out: CssConversion = { differences: [], problems, notes };
  const target = options.target ?? "content";
  const size = options.size ?? [120, 48];

  const block = findKeyframes(source, name);
  if (block === undefined) {
    problems.push(`No @keyframes ${name} in the source.`);
    return out;
  }
  if (/\$\{/.test(block)) {
    problems.push(`@keyframes ${name} has a \${...} value only the app knows. Put the value in, or write that frame by hand.`);
    return out;
  }
  const frames = parseFrames(block, problems);
  const animation = findAnimation(source, name, options.animation, problems, notes);
  if (!frames || !animation || problems.length) return out;

  // Uniform scale unless some frame scales the axes apart; then every frame says both axes.
  if (frames.some((f) => f.values.has("scaleX") || f.values.has("scaleY"))) {
    for (const f of frames) {
      const s = f.values.get("scale");
      if (s === undefined) continue;
      f.values.delete("scale");
      f.values.set("scaleX", isList(s) ? { fns: s.fns, part: "scaleX" } : s);
      f.values.set("scaleY", isList(s) ? { fns: s.fns, part: "scaleY" } : s);
    }
  }
  // A property that never changes and is the element's own value isn't part of the motion.
  for (const prop of new Set(frames.flatMap((f) => [...f.values.keys()]))) {
    const vs = frames.filter((f) => f.values.has(prop)).map((f) => f.values.get(prop)!);
    if (vs.every((v) => sameValue(v, KINDS[prop].own))) for (const f of frames) f.values.delete(prop);
  }
  const tracks = new Map<string, Frame[]>();
  for (const f of frames) {
    for (const [prop, value] of f.values) {
      const list = tracks.get(prop) ?? [];
      list.push({ at: f.at, values: new Map([[prop, value]]), ease: f.ease });
      tracks.set(prop, list);
    }
  }
  // A property CSS doesn't name at 0% or 100% runs from or to the element's own value.
  for (const [prop, list] of tracks) {
    // A transform part runs from or to the element's own transform: none, an empty list.
    const own: Value = list.some((f) => isList(f.values.get(prop)!)) ? { fns: [], part: prop as Part } : KINDS[prop].own;
    if (own === "") {
      if (list[0].at !== 0 || list[list.length - 1].at !== 1) problems.push(`"${prop}" isn't set at 0% and 100%, so CSS runs from the element's own color, which only the page knows. Add it to both.`);
      continue;
    }
    if (list[0].at !== 0) {
      list.unshift({ at: 0, values: new Map([[prop, own]]) });
      notes.push(`"${prop}" has no 0% frame: it starts from the element's own value, taken as ${show(own)}.`);
    }
    if (list[list.length - 1].at !== 1) {
      list.push({ at: 1, values: new Map([[prop, own]]) });
      notes.push(`"${prop}" has no 100% frame: it ends at the element's own value, taken as ${show(own)}.`);
    }
  }
  if (problems.length) return out;

  const infinite = animation.iterations === Infinity;
  if (!infinite && (animation.iterations !== Math.floor(animation.iterations) || animation.iterations < 1)) {
    problems.push(`It plays ${animation.iterations} times; nudg plays a one-off whole times, or loops. Use a whole count or infinite.`);
    return out;
  }
  if (infinite) for (const prop of tracks.keys()) if (KINDS[prop].unit === "ΔE") problems.push(`"${prop}" loops a color; nudg loops numbers only. Loop opacity on a colored layer instead.`);
  if (problems.length) return out;

  const doc = infinite ? loopDoc(tracks, animation, target, problems) : onceDoc(tracks, animation, target, problems, notes);
  if (!doc) return out;
  if (!infinite && animation.delay > 0 && animation.fill !== "backwards" && animation.fill !== "both")
    notes.push("During the delay CSS shows the element as it is (no backwards fill); nudg holds the first frame. That is usually what was meant: add `both` to the CSS to see it there too.");
  if (!infinite && animation.fill !== "forwards" && animation.fill !== "both") {
    const changed = [...tracks].filter(([prop, list]) => KINDS[prop].own !== "" && !sameValue(lastValue(list, animation), KINDS[prop].own));
    if (changed.length) notes.push(`Without a forwards fill CSS jumps back to the element's own ${changed.map(([p]) => p).join(", ")} at the end; nudg stays at the last frame.`);
  }

  // The proof, at two sizes so a share of the element's size can't pass as a number.
  const differences = prove(doc, tracks, animation, target, size, infinite);
  const other = prove(doc, tracks, animation, target, [size[0] * 1.7 + 13, size[1] * 1.3 + 7], infinite);
  for (const d of differences) {
    const o = other.find((x) => x.property === d.property);
    if (o && o.max > d.max) Object.assign(d, { max: o.max, at: o.at });
  }
  out.differences = differences;
  for (const d of differences) {
    if (d.unit === "ΔE") {
      if (d.max > 0.02) notes.push(`"${d.property}" passes through different colors on the way (ΔE ${round(d.max, 3)} at ${round(d.at, 3)} s): CSS blends in sRGB, nudg in OKLab, which keeps the brightness even.`);
      continue;
    }
    if (d.property === "skew" && d.max > d.limit) problems.push(`CSS skews the element (a rotate after a non-uniform scale): a corner leans ${round(d.max, 3)}px at ${round(d.at, 3)} s, and nudg draws no skew (the limit is ${d.limit}px). Scale uniformly where it rotates, or scale after the rotate.`);
    else if (d.max === Infinity) problems.push(`"${d.property}": at ${round(d.at, 3)} s CSS's transform can't be read back as translate, rotate and scale.`);
    else if (d.max > d.limit)
      problems.push(
        `"${d.property}" is ${round(d.max, 3)}${d.unit} off at ${round(d.at, 3)} s (the limit is ${d.limit}${d.unit})` +
          (["x", "y", "rotation", "scale", "scaleX", "scaleY"].includes(d.property) ? ": CSS blends the transform lists function by function, and between these frames that path differs from nudg's. Add a frame in between, or put the translate first." : "."),
      );
  }
  if (problems.length) return out;
  out.doc = doc;
  out.play = infinite ? "playDoc(file, element) (or useNudg): the loop runs while it is bound." : 'useNudgOnce(file) in React, or playDoc(file, element, { start: "host.show", release: "settle" }).';
  if (!infinite) out.spring = fitSpring(doc, tracks, animation, target, size);
  return out;
}

// --- reading the CSS -----------------------------------------------------------

function findKeyframes(source: string, name: string): string | undefined {
  const re = new RegExp(`@(?:-webkit-)?keyframes\\s+${escape(name)}\\s*\\{`, "g");
  const m = re.exec(source);
  if (!m) return undefined;
  let depth = 0;
  for (let i = m.index + m[0].length - 1; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(m.index + m[0].length, i);
  }
  return undefined;
}

function parseFrames(block: string, problems: string[]): Frame[] | undefined {
  problems_ = problems;
  const byAt = new Map<number, Frame>();
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) {
    const selectors = m[1].split(",").map((s) => s.trim()).filter(Boolean);
    const body = m[2];
    for (const sel of selectors) {
      const at = sel === "from" ? 0 : sel === "to" ? 1 : /^-?[\d.]+%$/.test(sel) ? parseFloat(sel) / 100 : NaN;
      if (!(at >= 0 && at <= 1)) {
        problems.push(`"${sel}" isn't a keyframe offset (from, to or a percentage).`);
        continue;
      }
      const frame = byAt.get(at) ?? { at, values: new Map() };
      byAt.set(at, frame);
      parseDeclarations(body, frame, sel, problems);
    }
  }
  if (byAt.size === 0) {
    problems.push("The @keyframes block has no frames.");
    return undefined;
  }
  return [...byAt.values()].sort((a, b) => a.at - b.at);
}

function parseDeclarations(body: string, frame: Frame, sel: string, problems: string[]) {
  for (const decl of splitTop(body, ";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const value = decl.slice(i + 1).trim().replace(/\s*!important$/, "");
    const where = `${sel} ${prop}`;
    switch (prop) {
      case "transform":
        if (["x", "y", "rotation", "scale", "scaleX", "scaleY"].some((p) => frame.values.has(p) && !isList(frame.values.get(p)!))) problems.push(`${where}: transform beside the translate, rotate or scale property; CSS applies both. Use one of them.`);
        parseTransform(value, frame, where, problems);
        break;
      case "translate": {
        const [x, y = "0px"] = splitTop(value, " ");
        if (value === "none") break;
        set(frame, "x", length(x, "width", where, problems));
        set(frame, "y", length(y, "height", where, problems));
        break;
      }
      case "scale": {
        if (value === "none") break;
        const [a, b] = splitTop(value, " ").map((s) => number(s, where, problems));
        if (b === undefined || a === b) set(frame, "scale", a);
        else (set(frame, "scaleX", a), set(frame, "scaleY", b));
        break;
      }
      case "rotate":
        if (value !== "none") set(frame, "rotation", angle(value, where, problems));
        break;
      case "opacity":
        set(frame, "opacity", /%$/.test(value) ? parseFloat(value) / 100 : number(value, where, problems));
        break;
      case "width":
      case "height":
        set(frame, prop, length(value, undefined, where, problems));
        break;
      case "background":
      case "background-color":
        set(frame, "color", color(value, where, problems));
        break;
      case "filter": {
        const blur = /^blur\(\s*([^)]+)\)$/.exec(value);
        if (value === "none") set(frame, "blur", 0);
        else if (blur) set(frame, "blur", length(blur[1], undefined, where, problems));
        else problems.push(`${where}: only blur() maps to a nudg property ("${value}").`);
        break;
      }
      case "box-shadow":
        parseShadow(value, frame, where, problems);
        break;
      case "animation-timing-function":
        frame.ease = timing(value, where, problems);
        break;
      default:
        problems.push(`${where}: no nudg property moves "${prop}". A custom property (target.custom.<name>, drawn through var(--nudg-<name>)) keeps its timing in nudg.`);
    }
  }
}

function set(frame: Frame, prop: string, value: Value | undefined) {
  if (value === undefined) return;
  if (frame.values.has(prop) && isList(frame.values.get(prop)!)) problems_.push(`${prop}: set by transform and by its own property; CSS applies both. Use one of them.`);
  frame.values.set(prop, value);
}

function isList(v: Value): v is TList {
  return typeof v === "object" && "fns" in v;
}

/** Problems found while setting values, collected by parseFrames. */
let problems_: string[] = [];

/**
 * A transform list, kept as CSS wrote it: CSS interpolates function by function, so the
 * proof needs the list. Its value at a frame is the list composed and read back in nudg's
 * order (translate, then rotate, then scale): a translate after a turn becomes the turned
 * translate. Only a skew (a rotate after a non-uniform scale) has no nudg equivalent.
 */
function parseTransform(value: string, frame: Frame, where: string, problems: string[]) {
  const fns: Fn[] = [];
  if (value !== "none") {
    const found = [...value.matchAll(/([a-zA-Z0-9]+)\(([^)]*)\)/g)];
    if (found.map((f) => f[0]).join("").replace(/\s/g, "") !== value.replace(/\s/g, "")) {
      problems.push(`${where}: "${value}" isn't a list of transform functions.`);
      return;
    }
    for (const [, fn, raw] of found) {
      const args = raw.split(",").map((x) => x.trim());
      const len = (r: string | undefined, axis: "width" | "height"): Length => asLength(length(r ?? "0px", axis, where, problems) ?? 0);
      if (fn === "translate") fns.push({ k: "t", x: len(args[0], "width"), y: len(args[1], "height") });
      else if (fn === "translateX") fns.push({ k: "t", x: len(args[0], "width"), y: { px: 0 } });
      else if (fn === "translateY") fns.push({ k: "t", x: { px: 0 }, y: len(args[0], "height") });
      else if (fn === "rotate" || fn === "rotateZ") fns.push({ k: "r", a: angle(args[0], where, problems) ?? 0 });
      else if (fn === "scale") {
        const a = number(args[0], where, problems) ?? 1;
        fns.push({ k: "s", x: a, y: args[1] === undefined ? a : number(args[1], where, problems) ?? a });
      } else if (fn === "scaleX") fns.push({ k: "s", x: number(args[0], where, problems) ?? 1, y: 1 });
      else if (fn === "scaleY") fns.push({ k: "s", x: 1, y: number(args[0], where, problems) ?? 1 });
      else {
        problems.push(`${where}: ${fn}() has no nudg property (nudg moves in 2D: translate, rotate, scale).`);
        return;
      }
    }
  }
  // A skew (a rotate after a non-uniform scale) is measured by the proof, in pixels at the corners.
  const parts = decompose(fns)!;
  for (const part of ["x", "y", "rotation"] as const) frame.values.set(part, { fns, part });
  if (Math.abs(parts.scaleX - parts.scaleY) < 1e-12) frame.values.set("scale", { fns, part: "scale" });
  else (frame.values.set("scaleX", { fns, part: "scaleX" }), frame.values.set("scaleY", { fns, part: "scaleY" }));
}

function asLength(v: Value): Length {
  return typeof v === "number" ? { px: v } : (v as Length);
}

function scaleLength(v: Length, k: number): Length {
  const out: Length = { px: v.px * k };
  if (v.width !== undefined) out.width = v.width * k;
  if (v.height !== undefined) out.height = v.height * k;
  return out;
}

function addLength(a: Length, b: Length): Length {
  return asLength(add(a, b));
}

/**
 * The list composed (CSS multiplies left to right, so the last function applies first) and
 * read back as nudg draws it: translate, rotate, scale. Undefined when it skews.
 */
type Parts = { x: Length; y: Length; rotation: number; scaleX: number; scaleY: number; shear: number };

function decompose(fns: Fn[]): Parts | undefined {
  let [a, b, c, d] = [1, 0, 0, 1];
  let tx: Length = { px: 0 };
  let ty: Length = { px: 0 };
  let turned = 0;
  for (const f of fns) {
    if (f.k === "t") {
      tx = addLength(tx, addLength(scaleLength(f.x, a), scaleLength(f.y, c)));
      ty = addLength(ty, addLength(scaleLength(f.x, b), scaleLength(f.y, d)));
    } else {
      const [na, nb, nc, nd] = f.k === "r" ? [Math.cos((f.a * Math.PI) / 180), Math.sin((f.a * Math.PI) / 180), -Math.sin((f.a * Math.PI) / 180), Math.cos((f.a * Math.PI) / 180)] : [f.x, 0, 0, f.y];
      [a, b, c, d] = [a * na + c * nb, b * na + d * nb, a * nc + c * nd, b * nc + d * nd];
      if (f.k === "r") turned += f.a;
    }
  }
  const scaleX = Math.hypot(a, b);
  if (scaleX < 1e-12) {
    // Scaled to nothing (scale(0) to pop in from a point): read the parts as written.
    const sx = fns.reduce((p, f) => (f.k === "s" ? p * f.x : p), 1);
    const sy = fns.reduce((p, f) => (f.k === "s" ? p * f.y : p), 1);
    return { x: tx, y: ty, rotation: turned, scaleX: sx, scaleY: sy, shear: 0 };
  }
  const scaleY = (a * d - b * c) / scaleX;
  // How far the y axis leans off square, per unit of height: a skew nudg can't draw.
  const shear = (a * c + b * d) / scaleX;
  // Keep whole turns as written (rotate(360deg) spins); a mirrored scale reads its angle back.
  const read = (Math.atan2(b, a) * 180) / Math.PI;
  const off = ((turned - read) % 360 + 540) % 360 - 180;
  const rotation = Math.abs(off) < 1e-6 ? turned : read;
  return { x: tx, y: ty, rotation, scaleX, scaleY, shear };
}

/** A value with its transform list read back: a number, a length or a color. */
function plain(v: Value): number | Length | string {
  if (typeof v !== "object" || !("fns" in v)) return v;
  const p = decompose(v.fns)!;
  const out = v.part === "scale" ? p.scaleX : p[v.part];
  return typeof out === "number" ? out : out.width === undefined && out.height === undefined ? out.px : out;
}

/** CSS's own interpolation of two transform lists at progress `k`, read back as one part. */
function transformAt(from: TList, to: TList, k: number, size: [number, number]): number {
  let A = from.fns;
  let B = to.fns;
  const identity = (f: Fn): Fn => (f.k === "t" ? { k: "t", x: { px: 0 }, y: { px: 0 } } : f.k === "r" ? { k: "r", a: 0 } : { k: "s", x: 1, y: 1 });
  // A shorter list (none is empty) is padded with identity functions when the rest match.
  if (A.length < B.length && A.every((f, i) => f.k === B[i].k)) A = [...A, ...B.slice(A.length).map(identity)];
  if (B.length < A.length && B.every((f, i) => f.k === A[i].k)) B = [...B, ...A.slice(B.length).map(identity)];
  const part = (p: Parts | undefined): number => {
    if (!p) return NaN;
    const v = from.part === "scale" ? p.scaleX : p[from.part];
    return typeof v === "number" ? v : (resolve(v, size) as number);
  };
  if (A.length === B.length && A.every((f, i) => f.k === B[i].k)) {
    const mix = A.map((f, i): Fn => {
      const g = B[i];
      if (f.k === "t" && g.k === "t") return { k: "t", x: addLength(scaleLength(f.x, 1 - k), scaleLength(g.x, k)), y: addLength(scaleLength(f.y, 1 - k), scaleLength(g.y, k)) };
      if (f.k === "r" && g.k === "r") return { k: "r", a: f.a + (g.a - f.a) * k };
      const fs = f as Fn & { k: "s" };
      const gs = g as Fn & { k: "s" };
      return { k: "s", x: fs.x + (gs.x - fs.x) * k, y: fs.y + (gs.y - fs.y) * k };
    });
    return part(decompose(mix));
  }
  // Lists that don't match interpolate as matrices: decomposed, the angle the short way round.
  const p0 = decompose(A);
  const p1 = decompose(B);
  if (!p0 || !p1) return NaN;
  const r0 = (((p0.rotation % 360) + 540) % 360) - 180;
  let r1 = (((p1.rotation % 360) + 540) % 360) - 180;
  if (r1 - r0 > 180) r1 -= 360;
  if (r0 - r1 > 180) r1 += 360;
  const lerp = (x: number, y: number) => x + (y - x) * k;
  return part({ x: addLength(scaleLength(p0.x, 1 - k), scaleLength(p1.x, k)), y: addLength(scaleLength(p0.y, 1 - k), scaleLength(p1.y, k)), rotation: lerp(r0, r1), scaleX: lerp(p0.scaleX, p1.scaleX), scaleY: lerp(p0.scaleY, p1.scaleY), shear: lerp(p0.shear, p1.shear) });
}

function parseShadow(value: string, frame: Frame, where: string, problems: string[]) {
  if (value === "none") {
    for (const [p, v] of [["shadowX", 0], ["shadowY", 0], ["shadowBlur", 0], ["shadowColor", "#00000000"]] as const) frame.values.set(p, v);
    return;
  }
  if (splitTop(value, ",").length > 1) return void problems.push(`${where}: several shadows; nudg draws one.`);
  if (/\binset\b/.test(value)) return void problems.push(`${where}: an inset shadow; nudg's shadow is outside the box. A ring element whose opacity moves draws the same.`);
  const parts = splitTop(value, " ");
  const lengths = parts.filter((p) => /^-?[\d.]+(px)?$/.test(p));
  const rest = parts.filter((p) => !lengths.includes(p));
  if (lengths.length === 4 && parseFloat(lengths[3]) !== 0) return void problems.push(`${where}: a shadow spread; nudg shadows have none. A separate ring element whose scale grows as it fades draws a spreading ring.`);
  if (lengths.length < 2) return void problems.push(`${where}: "${value}" isn't a shadow nudg can read.`);
  frame.values.set("shadowX", parseFloat(lengths[0]));
  frame.values.set("shadowY", parseFloat(lengths[1]));
  frame.values.set("shadowBlur", lengths[2] ? parseFloat(lengths[2]) : 0);
  const c = rest.length ? color(rest.join(" "), where, problems) : "#000000ff";
  if (c) frame.values.set("shadowColor", c);
}

function length(raw: string, axis: "width" | "height" | undefined, where: string, problems: string[]): Value | undefined {
  const s = raw.trim();
  const px = /^(-?[\d.]+)(px)?$/.exec(s);
  if (px && (px[2] || parseFloat(px[1]) === 0)) return parseFloat(px[1]);
  const pct = /^(-?[\d.]+)%$/.exec(s);
  if (pct && axis) return { px: 0, [axis]: parseFloat(pct[1]) / 100 };
  problems.push(`${where}: "${s}" isn't a length nudg can read (px, or a percentage of the element's own size in a translate).`);
  return undefined;
}

function add(a0: Value, b0: Value | undefined): Value {
  if (b0 === undefined) return a0;
  const a = plain(a0);
  const b = plain(b0);
  const la = typeof a === "number" ? { px: a } : (a as Length);
  const lb = typeof b === "number" ? { px: b } : (b as Length);
  const sum: Length = { px: la.px + lb.px };
  const w = (la.width ?? 0) + (lb.width ?? 0);
  const h = (la.height ?? 0) + (lb.height ?? 0);
  if (w) sum.width = w;
  if (h) sum.height = h;
  return sum.width === undefined && sum.height === undefined ? sum.px : sum;
}

function angle(raw: string, where: string, problems: string[]): number | undefined {
  const m = /^(-?[\d.]+)(deg|turn|rad|grad)?$/.exec(raw.trim());
  if (!m || (!m[2] && parseFloat(m[1]) !== 0)) {
    problems.push(`${where}: "${raw}" isn't an angle.`);
    return undefined;
  }
  const n = parseFloat(m[1]);
  return m[2] === "turn" ? n * 360 : m[2] === "rad" ? (n * 180) / Math.PI : m[2] === "grad" ? n * 0.9 : n;
}

function number(raw: string, where: string, problems: string[]): number | undefined {
  const n = Number(raw.trim());
  if (raw.trim() === "" || !Number.isFinite(n)) {
    problems.push(`${where}: "${raw}" isn't a number.`);
    return undefined;
  }
  return n;
}

const NAMED_COLORS: Record<string, string> = { transparent: "#00000000", black: "#000000ff", white: "#ffffffff", red: "#ff0000ff", green: "#008000ff", blue: "#0000ffff" };

function color(raw: string, where: string, problems: string[]): string | undefined {
  const s = raw.trim().toLowerCase();
  if (NAMED_COLORS[s]) return NAMED_COLORS[s];
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join("");
    return "#" + (h.length === 6 ? h + "ff" : h);
  }
  const rgb = /^rgba?\(([^)]*)\)$/.exec(s);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean);
    const ch = parts.slice(0, 3).map((p) => (p.endsWith("%") ? (parseFloat(p) / 100) * 255 : parseFloat(p)));
    const a = parts[3] === undefined ? 1 : parts[3].endsWith("%") ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    if (ch.length === 3 && [...ch, a].every(Number.isFinite)) return "#" + [...ch, a * 255].map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, "0")).join("");
  }
  problems.push(`${where}: "${raw}" isn't a color nudg can read here (hex, rgb() or rgba()). Put the color in, not a variable or color-mix().`);
  return undefined;
}

function timing(raw: string, where: string, problems: string[]): Ease | undefined {
  const s = raw.trim();
  if (CSS_EASES[s]) return CSS_EASES[s];
  const bez = /^cubic-bezier\(([^)]*)\)$/.exec(s);
  if (bez) {
    const n = bez[1].split(",").map((x) => Number(x.trim()));
    if (n.length === 4 && n.every(Number.isFinite)) return [n[0], n[1], n[2], n[3]];
  }
  if (/^steps|^step-/.test(s)) problems.push(`${where}: ${s} jumps in steps (a sprite sheet); nudg moves continuously.`);
  else problems.push(`${where}: "${s}" isn't a timing function.`);
  return undefined;
}

/** The animation line that plays `name`: its first use in the source, or `override`. */
function findAnimation(source: string, name: string, override: string | undefined, problems: string[], notes: string[]): Animation | undefined {
  const uses: string[] = [];
  const re = /animation\s*:\s*["'`]?((?:\$\{[^}]*\}|[^;}"'`\n])+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) for (const one of splitTop(m[1], ",")) if (splitTop(one.trim(), " ").includes(name)) uses.push(one.trim());
  const distinct = [...new Set(uses)];
  if (distinct.length > 1) notes.push(`${name} is played ${distinct.length} ways (${distinct.join(" | ")}); this file follows the first. Pass the animation to convert another.`);
  const line = [distinct[0] ?? "", override ?? ""].join(" ").trim();
  if (!distinct.length && !override) {
    problems.push(`No animation line plays ${name}, so its duration is unknown. Pass one, e.g. --animation "0.6s ease-out".`);
    return undefined;
  }
  const a: Animation = { duration: 0, delay: 0, ease: CSS_EASES.ease, iterations: 1, direction: "normal", fill: "none" };
  let times = 0;
  for (const token of splitTop(line, " ")) {
    if (token === name) continue;
    if (/\$\{/.test(token)) {
      // A value only the app knows is fine when the override gives it.
      if (override) continue;
      problems.push(`The animation line has "${token}", a value only the app knows. Pass the line with numbers, e.g. --animation "0.3s ease".`);
      continue;
    }
    const t = /^(-?[\d.]+)(m?s)$/.exec(token);
    if (t) {
      const sec = parseFloat(t[1]) / (t[2] === "ms" ? 1000 : 1);
      // Each line's first time is a duration and its second a delay; an override starts over.
      if (times % 2 === 0) a.duration = sec;
      else a.delay = sec;
      times++;
      continue;
    }
    if (CSS_EASES[token] || /^(cubic-bezier|steps)\(|^step-/.test(token)) {
      const e = timing(token, "animation", problems);
      if (e) a.ease = e;
    } else if (token === "infinite") a.iterations = Infinity;
    else if (/^[\d.]+$/.test(token)) a.iterations = parseFloat(token);
    else if (["normal", "reverse", "alternate", "alternate-reverse"].includes(token)) a.direction = token as Animation["direction"];
    else if (["none", "forwards", "backwards", "both"].includes(token)) a.fill = token as Animation["fill"];
    else if (["running", "paused"].includes(token)) continue;
    else if (!override) continue; // another animation's name in the same line
  }
  if (!(a.duration > 0)) problems.push(`${name} has no duration. Pass one, e.g. --animation "0.6s".`);
  if (a.delay < 0) problems.push(`A negative delay starts ${name} partway; nudg starts at the beginning.`);
  return a;
}

// --- one cycle of CSS, as CSS computes it ----------------------------------------

/** The cubic Bézier mirrored in time: a leg played backwards. */
function reversed(e: Ease): Ease {
  return e === "linear" ? "linear" : [e[2], e[3], e[0], e[1]].map((x) => round(1 - x, 12)) as unknown as Ease;
}

function lastValue(list: Frame[], a: Animation): Value {
  const forward = a.direction === "normal" || (a.direction === "alternate" && a.iterations % 2 === 1) || (a.direction === "alternate-reverse" && a.iterations % 2 === 0);
  return forward ? list[list.length - 1].values.values().next().value! : list[0].values.values().next().value!;
}

/**
 * A property's points over the whole run (or one period of a loop), normalized to 0..1, each
 * with the ease of the leg after it: directions and iterations unrolled.
 */
function unroll(list: Frame[], a: Animation, cycles: number): { at: number; value: Value; ease: Ease }[] {
  const leg = (f: Frame) => f.ease ?? a.ease;
  const forward = list.map((f) => ({ at: f.at, value: f.values.values().next().value!, ease: leg(f) }));
  const backward = [...list].reverse().map((f, i, all) => ({ at: 1 - f.at, value: f.values.values().next().value!, ease: i + 1 < all.length ? reversed(leg(all[i + 1])) : "linear" as Ease }));
  const out: { at: number; value: Value; ease: Ease }[] = [];
  for (let c = 0; c < cycles; c++) {
    const rev = a.direction === "reverse" || (a.direction === "alternate" && c % 2 === 1) || (a.direction === "alternate-reverse" && c % 2 === 0);
    for (const p of rev ? backward : forward) {
      const at = (c + p.at) / cycles;
      const last = out[out.length - 1];
      if (last && Math.abs(last.at - at) < 1e-12) {
        if (!sameValue(last.value, p.value)) return []; // a jump between cycles: reported by the caller
        last.ease = p.ease;
        continue;
      }
      out.push({ at, value: p.value, ease: p.ease });
    }
  }
  return out;
}

function sameEase(a: Ease, b: Ease): boolean {
  return a === "linear" || b === "linear" ? a === b : a.every((x, i) => Math.abs(x - b[i]) < 1e-9);
}

function sameValue(a: Value, b: Value): boolean {
  const x = plain(a);
  const y = plain(b);
  if (typeof x === "number" && typeof y === "number") return Math.abs(x - y) < 1e-9;
  return JSON.stringify(x) === JSON.stringify(y);
}

// --- writing nudg ----------------------------------------------------------------

function nudgValue(target: string, value: Value): Json {
  const v = plain(value);
  if (typeof v === "number" || typeof v === "string") return typeof v === "number" ? round(v, 6) : v;
  const parts = (["width", "height"] as const).filter((k) => v[k] !== undefined);
  if (parts.length !== 1) return null;
  const m: JsonObject = { measure: `${target}.${parts[0]}`, times: round(v[parts[0]]!, 6) };
  if (v.px) m.plus = round(v.px, 6);
  return m;
}

function easeJson(e: Ease): Json {
  if (e === "linear") return "linear";
  for (const [n, b] of Object.entries(NAMED_EASES)) if (b !== "linear" && b.every((x, i) => Math.abs(x - e[i]) < 1e-9)) return n;
  return e.map((x) => round(x, 6));
}

function onceDoc(tracks: Map<string, Frame[]>, a: Animation, target: string, problems: string[], notes: string[]): JsonObject | undefined {
  const total = a.delay + a.duration * a.iterations;
  const values: JsonObject = {};
  const set: JsonObject = {};
  const animate: JsonObject = {};
  const enter: JsonObject = {};
  for (const [prop, list] of tracks) {
    let points = unroll(list, a, a.iterations);
    if (!points.length) {
      problems.push(`"${prop}" ends a cycle away from where the next starts, and CSS jumps between them; a one-off nudg file can't jump mid-way. Play it once, or make 0% and 100% the same.`);
      continue;
    }
    points = points.map((p) => ({ ...p, at: (a.delay + p.at * a.duration * a.iterations) / total }));
    // The delay is a hold at the first frame.
    if (a.delay > 0) points.unshift({ at: 0, value: points[0].value, ease: "linear" });
    const first = points[0];
    const last = points[points.length - 1];
    const key = `${target}.${prop}`;
    const from = nudgValue(target, first.value);
    const to = nudgValue(target, last.value);
    if (from === null || to === null) {
      problems.push(`"${prop}" mixes shares of the element's width and height in one value.`);
      continue;
    }
    values[key] = from;
    if (points.every((p) => sameValue(p.value, first.value))) {
      notes.push(`"${prop}" holds ${show(first.value)} throughout: it is the element's base value, not motion.`);
      continue;
    }
    set[key] = to;
    // Every keyframed property has a motion too, so the keyframes start from the first frame (devlog 2026-11-12).
    animate[key] = { tween: { duration: round(total, 6), ease: easeJson(first.ease) } };
    const inner = points.slice(1, -1);
    if (inner.length === 0 && a.delay === 0) continue;
    if (inner.length === 0) {
      (animate[key] as JsonObject).tween = { duration: round(a.duration * a.iterations, 6), ease: easeJson(points[1].ease), delay: round(a.delay, 6) };
      continue;
    }
    const frames: Json[] = [];
    for (const p of inner) {
      const value = nudgValue(target, p.value);
      if (value === null) {
        problems.push(`"${prop}" mixes shares of the element's width and height in one value.`);
        return undefined;
      }
      const frame: JsonObject = { at: round(p.at, 6), value };
      if (!sameEase(p.ease, first.ease)) frame.ease = easeJson(p.ease);
      frames.push(frame);
    }
    enter[key] = { keyframes: frames, duration: round(total, 6), ease: easeJson(first.ease) };
  }
  if (problems.length) return undefined;
  notes.push('The file goes from "hidden" (the first frame) to "shown" (the last) on host.show.');
  const shown: JsonObject = { set };
  if (Object.keys(enter).length) shown.enter = enter;
  return { nudg: VERSION, targets: [target], values, animate, initial: "hidden", when: { "host.show": "shown" }, states: { hidden: {}, shown } };
}

function loopDoc(tracks: Map<string, Frame[]>, a: Animation, target: string, problems: string[]): JsonObject | undefined {
  const alternate = a.direction === "alternate" || a.direction === "alternate-reverse";
  const cycles = alternate ? 2 : 1;
  const values: JsonObject = {};
  const loop: JsonObject = {};
  for (const [prop, list] of tracks) {
    const points = unroll(list, a, cycles);
    const nums = points.map((p) => p.value);
    if (!points.length || nums.some((v) => typeof v === "string")) {
      problems.push(`"${prop}" can't loop as nudg loops.`);
      continue;
    }
    const base = nums[0];
    const key = `${target}.${prop}`;
    const baseJson = nudgValue(target, base);
    if (baseJson === null) return void problems.push(`"${prop}" mixes shares of the element's width and height in one value.`);
    values[key] = baseJson;
    if (nums.every((v) => sameValue(v, base))) continue;
    const offset = (v: Value): Json => nudgValue(target, add(v, negate(base)));
    const frames: Json[] = points.slice(1, -1).map((p) => {
      const f: JsonObject = { at: round(p.at, 6), value: offset(p.value) };
      if (!sameEase(p.ease, points[0].ease)) f.ease = easeJson(p.ease);
      return f;
    });
    const l: JsonObject = { to: offset(points[points.length - 1].value), duration: round(a.duration * cycles, 6), ease: easeJson(points[0].ease) };
    if (frames.length) l.keyframes = frames;
    if (a.delay > 0) l.delay = round(a.delay, 6);
    loop[key] = l;
  }
  if (problems.length) return undefined;
  return { nudg: VERSION, targets: [target], values, initial: "playing", states: { playing: { loop } } };
}

function negate(v0: Value): Value {
  const v = plain(v0);
  if (typeof v === "number") return -v;
  const l = v as Length;
  const out: Length = { px: -l.px };
  if (l.width !== undefined) out.width = -l.width;
  if (l.height !== undefined) out.height = -l.height;
  return out;
}

// --- the proof -------------------------------------------------------------------

function resolve(v0: Value, size: [number, number]): number | string {
  const v = plain(v0);
  if (typeof v === "number" || typeof v === "string") return v;
  return v.px + (v.width ?? 0) * size[0] + (v.height ?? 0) * size[1];
}

/** What CSS shows for one property at `t` seconds after the animation starts. */
function cssAt(list: Frame[], a: Animation, t: number, size: [number, number]): number | number[] {
  // An infinite animation repeats one period (two cycles when it alternates), starting over each time.
  const infinite = a.iterations === Infinity;
  const cycles = infinite ? (a.direction === "alternate" || a.direction === "alternate-reverse" ? 2 : 1) : a.iterations;
  const points = unroll(list, a, cycles);
  const span = a.duration * cycles;
  const local = t - a.delay;
  const u = infinite ? (local <= 0 ? 0 : (local % span) / span) : Math.min(1, Math.max(0, local / span));
  for (let i = 1; i < points.length; i++) {
    const p0 = points[i - 1];
    const p1 = points[i];
    if (u > p1.at) continue;
    const k = easeAt(p0.ease, (u - p0.at) / (p1.at - p0.at || 1));
    if (isList(p0.value) && isList(p1.value)) return transformAt(p0.value, p1.value, k, size);
    const v0 = resolve(p0.value, size);
    const v1 = resolve(p1.value, size);
    if (typeof v0 === "string" || typeof v1 === "string") {
      // CSS blends colors in sRGB, premultiplied by alpha.
      const c0 = rgba(v0 as string);
      const c1 = rgba(v1 as string);
      const alpha = c0[3] + (c1[3] - c0[3]) * k;
      const ch = [0, 1, 2].map((j) => (alpha === 0 ? 0 : (c0[j] * c0[3] + (c1[j] * c1[3] - c0[j] * c0[3]) * k) / alpha));
      return hexToOklab("#" + [...ch, alpha].map((c) => Math.round(Math.max(0, Math.min(1, c)) * 255).toString(16).padStart(2, "0")).join(""));
    }
    return v0 + (v1 - v0) * k;
  }
  const last = resolve(points[points.length - 1].value, size);
  return typeof last === "string" ? hexToOklab(last) : last;
}

function rgba(hex: string): number[] {
  return [1, 3, 5, 7].map((i) => parseInt(hex.slice(i, i + 2) || "ff", 16) / 255);
}

function prove(doc: JsonObject, tracks: Map<string, Frame[]>, a: Animation, target: string, size: [number, number], infinite: boolean): CssDifference[] {
  const { program } = compile({ path: "from-css.nudg.json", text: JSON.stringify(doc) });
  if (!program) return [...tracks.keys()].map((property) => ({ property, max: Infinity, unit: KINDS[property].unit, at: 0, limit: LIMITS[KINDS[property].unit] ?? 0 }));
  const runtime = createRuntime(program);
  runtime.input(`${target}.layout.width`, size[0], 0);
  runtime.input(`${target}.layout.height`, size[1], 0);
  if (!infinite) runtime.send("host.show", 0);
  const span = infinite ? a.delay + a.duration * 3 : a.delay + a.duration * a.iterations;
  const out = new Map<string, CssDifference>();
  for (let i = 0; i <= SAMPLES; i++) {
    const t = (span * i) / SAMPLES;
    const sample = runtime.sample(t);
    for (const [prop, list] of tracks) {
      const css = cssAt(list, a, t, size);
      const nudg = sample[`${target}.${prop}`];
      const unit = KINDS[prop].unit;
      const raw = Array.isArray(css) ? Math.hypot(...hexToOklab(String(nudg)).slice(0, 3).map((c, j) => c - css[j])) : Math.abs(Number(nudg) - css);
      // NaN: CSS skews here, which no nudg property draws.
      const diff = Number.isNaN(raw) ? Infinity : raw;
      const d = out.get(prop) ?? { property: prop, max: 0, unit, at: 0, limit: LIMITS[unit] ?? 0 };
      if (diff > d.max) Object.assign(d, { max: diff, at: t });
      out.set(prop, d);
    }
  }
  // nudg draws no skew, so CSS's skew is the difference itself: how far a corner leans, in px.
  const list = [...tracks.values()].find((l) => l.some((f) => isList(f.values.values().next().value!)));
  if (list) {
    const shear = list.map((f): Frame => {
      const v = f.values.values().next().value!;
      return { ...f, values: new Map([["shear", isList(v) ? { fns: v.fns, part: "shear" as Part } : 0]]) };
    });
    const d: CssDifference = { property: "skew", max: 0, unit: "px", at: 0, limit: LIMITS.px };
    for (let i = 0; i <= SAMPLES; i++) {
      const t = (span * i) / SAMPLES;
      const lean = Math.abs(cssAt(shear, a, t, size) as number) * (size[1] / 2);
      const diff = Number.isNaN(lean) ? Infinity : lean;
      if (diff > d.max) Object.assign(d, { max: diff, at: t });
    }
    if (d.max > 1e-9) out.set("skew", d);
  }
  return [...out.values()].map((d) => ({ ...d, max: round(d.max, 6), at: round(d.at, 6) }));
}

// --- a spring for an overshoot ----------------------------------------------------

/**
 * Keyframes that pass their end and come back (1 → 1.32 → 0.94 → 1.06 → 1) are a spring
 * written out by hand. Fit one per such property: from the first frame to the last, or, when
 * they are the same value, a kick. The exact conversion stays the default; this is offered.
 */
function fitSpring(doc: JsonObject, tracks: Map<string, Frame[]>, a: Animation, target: string, size: [number, number]): CssConversion["spring"] {
  if (a.delay > 0 || a.iterations !== 1 || a.direction !== "normal") return undefined;
  const fitted: { prop: string; motion: JsonObject; kick?: number }[] = [];
  for (const [prop, list] of tracks) {
    if (KINDS[prop].unit === "ΔE" || list.length < 4) continue;
    const vals = list.map((f) => resolve(f.values.values().next().value!, size) as number);
    const end = vals[vals.length - 1];
    const signs = vals.slice(1, -1).map((v) => Math.sign(v - end)).filter((s) => s !== 0);
    const crossings = signs.slice(1).filter((s, i) => s !== signs[i]).length;
    if (crossings < 1) continue;
    const start = vals[0];
    const curve = Array.from({ length: SAMPLES + 1 }, (_, i) => cssAt(list, a, (a.duration * i) / SAMPLES, size) as number);
    let best = { err: Infinity, duration: 0, bounce: 0, kick: 0 };
    const kicks = start === end ? Array.from({ length: 41 }, (_, i) => ((i - 20) / 20) * 40 * Math.max(1e-3, Math.max(...vals.map((v) => Math.abs(v - end))))) : [0];
    for (let duration = 0.1; duration <= Math.max(1.5, a.duration * 2); duration += 0.02) {
      for (let bounce = 0; bounce <= 0.9; bounce += 0.02) {
        const s = { kind: "spring" as const, ...fromDurationBounce(duration, bounce) };
        for (const kick of kicks) {
          let err = 0;
          for (let i = 0; i <= SAMPLES && err < best.err; i++) err = Math.max(err, Math.abs(end + springAt(s, start - end, kick, (a.duration * i) / SAMPLES)[0] - curve[i]));
          if (err < best.err) best = { err, duration, bounce, kick };
        }
      }
    }
    const motion: JsonObject = { spring: { duration: round(best.duration, 2), bounce: round(best.bounce, 2) } };
    fitted.push(start === end ? { prop, motion, kick: round(best.kick, 3) } : { prop, motion });
  }
  if (!fitted.length) return undefined;
  const springDoc = JSON.parse(JSON.stringify(doc)) as JsonObject;
  const animate = springDoc.animate as JsonObject;
  const shown = (springDoc.states as JsonObject).shown as JsonObject;
  const enter = (shown.enter ?? {}) as JsonObject;
  for (const f of fitted) {
    const key = `${target}.${f.prop}`;
    animate[key] = f.motion;
    delete enter[key];
    if (f.kick !== undefined) enter[key] = { ...(f.motion as JsonObject), kick: f.kick };
  }
  if (Object.keys(enter).length) shown.enter = enter;
  else delete shown.enter;
  const differences = prove(springDoc, tracks, a, target, size, false).filter((d) => fitted.some((f) => f.prop === d.property));
  const summary = fitted
    .map((f) => {
      const d = differences.find((x) => x.property === f.prop)!;
      const vals = tracks.get(f.prop)!.map((fr) => resolve(fr.values.values().next().value!, size) as number);
      const travel = Math.max(...vals) - Math.min(...vals);
      return `${f.prop}: spring ${JSON.stringify((f.motion as JsonObject).spring)}${f.kick !== undefined ? ` with a kick of ${f.kick}` : ""}, up to ${d.max}${KINDS[f.prop].unit} from the CSS (${Math.round((d.max / travel) * 100)}% of its travel)`;
    })
    .join("; ");
  return { doc: springDoc, properties: fitted.map((f) => f.prop), differences, summary };
}

// --- helpers ---------------------------------------------------------------------

function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (depth === 0 && (sep === " " ? /\s/.test(ch) : ch === sep)) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function show(v0: Value): string {
  const v = plain(v0);
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

/** The conversion as text for a person: what was written, how close it is, and what to choose. */
export function formatFromCss(name: string, c: CssConversion): string {
  const lines: string[] = [];
  if (!c.doc) {
    lines.push(`@keyframes ${name}: not converted.`);
    for (const p of c.problems) lines.push(`  ✗ ${p}`);
  } else {
    lines.push(`@keyframes ${name}: converted, within the limits.`);
    for (const d of c.differences) lines.push(`  ${d.property}: at most ${d.max}${d.unit} from the CSS${d.unit === "ΔE" ? "" : ` (limit ${d.limit}${d.unit})`}`);
    if (c.play) lines.push(`  Play it with ${c.play}`);
  }
  for (const n of c.notes) lines.push(`  · ${n}`);
  if (c.spring) lines.push(`  A spring makes the same overshoot and carries on naturally when interrupted, but moves a little differently: ${c.spring.summary}.`);
  return lines.join("\n");
}
