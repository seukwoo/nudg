// Generates the README's images in docs/media/ from the example files.
// Run: npm run media
//
// Every moving value in the animated SVGs comes from the nudg runtime playing the real
// example files, sampled at 60 fps and written out as SMIL keyframes. Nothing is
// hand-animated, so the images stay true to the format as it changes.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRuntime, plot } from "../src/index.ts";
import { compilePath } from "../src/node/index.ts";
import { compile } from "../src/core/compile.ts";
import type { Program } from "../src/core/types.ts";

const OUT = "docs/media";
const FPS = 60;

const THEMES = {
  light: { card: "#ffffff", line: "#d0d7de", text: "#1f2328", muted: "#59636e", touch: "#1f2328", shadow: 0.25 },
  dark: { card: "#161b22", line: "#30363d", text: "#e6edf3", muted: "#9198a1", touch: "#1f2328", shadow: 0.5 },
};
type Theme = (typeof THEMES)[keyof typeof THEMES];

interface TimedEvent {
  t: number;
  event: string;
}

/** A click is down, up, tap; `hold` is how long the pointer stays down. */
function click(t: number, target: string, hold: number): TimedEvent[] {
  return [
    { t, event: `${target}.down` },
    { t: t + hold, event: `${target}.up` },
    { t: t + hold, event: `${target}.tap` },
  ];
}

/** Samples every property at 60 fps over one loop, and checks that the loop is seamless. */
function play(program: Program, events: TimedEvent[], loop: number, name: string) {
  const runtime = createRuntime(program);
  const queue = [...events].sort((a, b) => a.t - b.t);
  const frames: Record<string, number | string>[] = [];
  const count = Math.round(loop * FPS);
  for (let i = 0; i <= count; i++) {
    const t = i / FPS;
    while (queue.length && queue[0].t <= t) {
      const { t: at, event } = queue.shift()!;
      runtime.send(event, at);
    }
    frames.push(runtime.sample(t));
  }
  if (!runtime.settled(loop)) throw new Error(`${name}: still moving at ${loop}s, so the loop would jump`);
  const rounded = (f: Record<string, number | string>) =>
    JSON.stringify(Object.values(f).map((v) => (typeof v === "number" ? Math.abs(v) < 0.005 ? "0" : v.toFixed(2) : v)));
  if (rounded(frames[count]) !== rounded(frames[0])) throw new Error(`${name}: ends at ${rounded(frames[count])}, starts at ${rounded(frames[0])}`);
  return (key: string) => frames.map((f) => f[key]);
}

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

/**
 * One SMIL keyframe track. Keeps only the frames a straight line between the kept
 * neighbours can't reproduce, which shrinks the file without changing the motion.
 */
function track(values: (number | string)[], loop: number, write: (v: number | string) => string) {
  const last = values.length - 1;
  const keep = [0];
  for (let i = 1; i < last; i++) {
    const a = values[keep[keep.length - 1]];
    const b = values[i];
    const c = values[i + 1];
    if (typeof b === "number" && typeof a === "number" && typeof c === "number") {
      const t = (i - keep[keep.length - 1]) / (i + 1 - keep[keep.length - 1]);
      if (Math.abs(a + (c - a) * t - b) > 0.01) keep.push(i);
    } else if (b !== a || b !== c) keep.push(i);
  }
  keep.push(last);
  const keyTimes = keep.map((i) => fmt(i / last)).join(";");
  const vals = keep.map((i) => write(values[i])).join(";");
  return `dur="${loop}s" repeatCount="indefinite" calcMode="linear" keyTimes="${keyTimes}" values="${vals}"`;
}

const num = (v: number | string) => fmt(v as number);

function translateX(values: (number | string)[], loop: number) {
  return `<animateTransform attributeName="transform" type="translate" ${track(values, loop, (v) => `${num(v)} 0`)}/>`;
}

function scale(values: (number | string)[], loop: number) {
  return `<animateTransform attributeName="transform" type="scale" ${track(values, loop, num)}/>`;
}

function fill(values: (number | string)[], loop: number) {
  return `<animate attributeName="fill" ${track(values, loop, String)}/>`;
}

/** Where the pointer touches: shown while it's down, then spreads and fades on release. */
function touch(cx: number, cy: number, presses: [number, number][], loop: number, theme: Theme) {
  const r: number[] = [];
  const o: number[] = [];
  for (let i = 0; i <= loop * FPS; i++) {
    const t = i / FPS;
    let radius = 14;
    let opacity = 0;
    for (const [down, up] of presses) {
      if (t >= down && t < up) opacity = Math.min(1, (t - down) / 0.05);
      else if (t >= up && t < up + 0.3) {
        const p = (t - up) / 0.3;
        radius = 14 + 10 * (1 - (1 - p) ** 2);
        opacity = 1 - p;
      }
    }
    r.push(radius);
    o.push(opacity);
  }
  return `<circle cx="${cx}" cy="${cy}" r="14" fill="${theme.touch}" fill-opacity="0.25" stroke="${theme.touch}" stroke-opacity="0.5" stroke-width="1.5" opacity="0">` +
    `<animate attributeName="r" ${track(r, loop, num)}/>` +
    `<animate attributeName="opacity" ${track(o, loop, num)}/></circle>`;
}

/** The toggle from examples/toggle.html, drawn at 2x with its top-left at (x, y). */
function toggle(x: number, y: number, at: (key: string) => (number | string)[], presses: [number, number][], loop: number, theme: Theme) {
  const knobScale = at("knob.scale")[0] === undefined ? "" : scale(at("knob.scale"), loop);
  return `<g transform="translate(${x} ${y}) scale(2)">
    <rect width="52" height="32" rx="16" fill="${at("track.color")[0]}">${fill(at("track.color"), loop)}</rect>
    <g>${translateX(at("knob.x"), loop)}
      <g transform="translate(16 16)"><g>${knobScale}
        <circle r="12" fill="#ffffff" filter="url(#knob-shadow)"/>
      </g></g>
    </g>
  </g>
  ${touch(x + 52, y + 32, presses, loop, theme)}`;
}

const HEART = "M12 21s-7.4-4.5-9.9-9.2C.5 8.5 2.4 4 6.5 4c2.3 0 3.9 1.3 5.5 3.2C13.6 5.3 15.2 4 17.5 4c4.1 0 6 4.5 4.4 7.8C19.4 16.5 12 21 12 21z";

/** The heart from examples/like.html, 72 px, centred on (cx, cy). */
function heart(cx: number, cy: number, at: (key: string) => (number | string)[], presses: [number, number][], loop: number, theme: Theme) {
  return `<g transform="translate(${cx} ${cy}) scale(3)"><g>${scale(at("heart.scale"), loop)}
    <path transform="translate(-12 -12.5)" d="${HEART}" fill="${at("heart.color")[0]}">${fill(at("heart.color"), loop)}</path>
  </g></g>
  ${touch(cx, cy, presses, loop, theme)}`;
}

function card(x: number, y: number, w: number, h: number, title: string, caption: string, theme: Theme) {
  return `<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}" rx="12" fill="${theme.card}" stroke="${theme.line}"/>
  <text x="${x + w / 2}" y="${y + h - 38}" text-anchor="middle" class="title">${escape(title)}</text>
  <text x="${x + w / 2}" y="${y + h - 18}" text-anchor="middle" class="caption">${escape(caption)}</text>`;
}

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

function svg(width: number, height: number, label: string, theme: Theme, body: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(label)}">
<title>${escape(label)}</title>
<style>
  text { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  .title { font-size: 14px; font-weight: 600; fill: ${theme.text}; }
  .caption { font-size: 12px; fill: ${theme.muted}; font-family: ui-monospace, "SF Mono", Menlo, monospace; }
</style>
<defs><filter id="knob-shadow" x="-50%" y="-50%" width="200%" height="200%">
  <feDropShadow dx="0" dy="0.5" stdDeviation="0.8" flood-color="#000" flood-opacity="${theme.shadow}"/>
</filter></defs>
${body}
</svg>
`;
}

function program(path: string): Program {
  const { program, diagnostics } = compilePath(path);
  if (!program) throw new Error(`${path}: ${diagnostics.map((d) => d.message).join("; ")}`);
  return program;
}

/** The toggle example with a different bounce, compiled from its edited text. */
function toggleWithBounce(bounce: number): Program {
  const path = "examples/toggle.nudg.json";
  const text = readFileSync(path, "utf8").replace('"bounce": 0.25', `"bounce": ${bounce}`);
  const { program } = compile({ path, text });
  if (!program) throw new Error(`toggle with bounce ${bounce} doesn't compile`);
  return program;
}

// --- hero: three examples, tapped in turn --------------------------------------

const HERO_LOOP = 7.2;
const HOLD = { quick: 0.12, press: 0.3 };
const heroScript = {
  toggle: [0.5, 4.1],
  press: [1.5, 5.0],
  like: [2.5, 5.9],
};
const presses = (taps: number[], hold: number) => taps.map((t): [number, number] => [t, t + hold]);
const hero = {
  toggle: play(program("examples/toggle.nudg.json"), heroScript.toggle.flatMap((t) => click(t, "track", HOLD.quick)), HERO_LOOP, "toggle"),
  press: play(program("examples/toggle-press.nudg.json"), heroScript.press.flatMap((t) => click(t, "track", HOLD.press)), HERO_LOOP, "toggle-press"),
  like: play(program("examples/like.nudg.json"), heroScript.like.flatMap((t) => click(t, "heart", HOLD.quick)), HERO_LOOP, "like"),
};

function heroSvg(theme: Theme) {
  const W = 232;
  const H = 200;
  const gap = 12;
  const col = (i: number) => i * (W + gap);
  return svg(W * 3 + gap * 2, H, "Three interactions played by nudg: a toggle, a toggle that shrinks while pressed, and a like button", theme, [
    card(col(0), 0, W, H, "Toggle", "toggle.nudg.json", theme),
    toggle(col(0) + W / 2 - 52, 46, hero.toggle, presses(heroScript.toggle, HOLD.quick), HERO_LOOP, theme),
    card(col(1), 0, W, H, "Toggle with press", "toggle-press.nudg.json", theme),
    toggle(col(1) + W / 2 - 52, 46, hero.press, presses(heroScript.press, HOLD.press), HERO_LOOP, theme),
    card(col(2), 0, W, H, "Like", "like.nudg.json", theme),
    heart(col(2) + W / 2, 78, hero.like, presses(heroScript.like, HOLD.quick), HERO_LOOP, theme),
  ].join("\n"));
}

// --- bouncier: the same toggle before and after a one-field edit ---------------

const BOUNCE_LOOP = 4;
const bounceTaps = [0.4, 2.2];
const bounces = [0.25, 0.6].map((b) =>
  play(toggleWithBounce(b), bounceTaps.flatMap((t) => click(t, "track", HOLD.quick)), BOUNCE_LOOP, `bounce ${b}`),
);

function bouncierSvg(theme: Theme) {
  const W = 352;
  const H = 168;
  const gap = 12;
  return svg(W * 2 + gap, H, 'The toggle with "bounce": 0.25, and after the edit to "bounce": 0.6', theme, [
    card(0, 0, W, H, "Before", '"bounce": 0.25', theme),
    toggle(W / 2 - 52, 34, bounces[0], presses(bounceTaps, HOLD.quick), BOUNCE_LOOP, theme),
    card(W + gap, 0, W, H, "After", '"bounce": 0.6', theme),
    toggle(W + gap + W / 2 - 52, 34, bounces[1], presses(bounceTaps, HOLD.quick), BOUNCE_LOOP, theme),
  ].join("\n"));
}

// --- write ------------------------------------------------------------------------

mkdirSync(OUT, { recursive: true });
for (const [name, theme] of Object.entries(THEMES)) {
  writeFileSync(`${OUT}/hero-${name}.svg`, heroSvg(theme));
  writeFileSync(`${OUT}/bouncier-${name}.svg`, bouncierSvg(theme));
}

// The motion graph is nudg plot's own output, as an agent would see it.
const graph = plot(program("examples/toggle.nudg.json"), {
  events: [{ t: 0.1, event: "track.tap" }, { t: 0.45, event: "track.tap" }],
  title: "toggle.nudg.json, tapped again mid-flight",
});
writeFileSync(`${OUT}/toggle-plot.svg`, graph.svg);

console.log(`wrote ${OUT}/`);
