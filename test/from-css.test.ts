import assert from "node:assert/strict";
import { test } from "node:test";
import { audit } from "../src/node/audit.ts";
import { fromCss } from "../src/core/from-css.ts";

const css = (keyframes: string, animation: string) => `${keyframes}\n.x { animation: ${animation}; }`;

test("from-css converts keyframes exactly, a percentage translate as a measure of the element", () => {
  const c = fromCss(css("@keyframes slideIn { from { transform: translateX(-100%); opacity: 0 } 60% { transform: translateX(5%) } to { transform: none; opacity: 1 } }", "slideIn .5s ease-out both"), "slideIn");
  assert.deepEqual(c.problems, []);
  const doc = c.doc as any;
  assert.deepEqual(doc.values["content.x"], { measure: "content.width", times: -1 });
  assert.deepEqual(doc.states.shown.enter["content.x"].keyframes, [{ at: 0.6, value: { measure: "content.width", times: 0.05 } }]);
  assert.equal(doc.states.shown.enter["content.x"].ease, "out");
  // Opacity has no inner frames: a tween from the first frame to the last does it.
  assert.deepEqual(doc.animate["content.opacity"], { tween: { duration: 0.5, ease: "out" } });
  assert.equal(doc.states.shown.enter["content.opacity"], undefined);
  for (const d of c.differences) assert.ok(d.max <= d.limit, `${d.property} ${d.max}`);
  assert.equal(c.spring, undefined);
});

test("from-css keeps an ease per frame and turns a delay into a hold", () => {
  const c = fromCss(css("@keyframes hop { 0% { transform: translateY(0); animation-timing-function: ease-out } 40% { transform: translateY(-40px); animation-timing-function: ease-in } 100% { transform: translateY(0) } }", "hop 0.6s linear 0.2s"), "hop");
  assert.deepEqual(c.problems, []);
  const enter = (c.doc as any).states.shown.enter["content.y"];
  assert.equal(enter.ease, "linear");
  assert.equal(enter.duration, 0.8);
  // The hold to 0.25 (0.2 s of 0.8), then 0.4 of the run: (0.2 + 0.24) / 0.8.
  assert.deepEqual(enter.keyframes, [{ at: 0.25, value: 0, ease: "out" }, { at: 0.55, value: -40, ease: "in" }]);
  assert.ok(c.differences.every((d) => d.max <= d.limit));
});

test("from-css makes an infinite animation a loop, alternate as one cycle out and back", () => {
  const c = fromCss(css("@keyframes blink { 0%, 100% { opacity: 1 } 50% { opacity: .25 } }", "blink 1.2s infinite"), "blink");
  assert.deepEqual(c.problems, []);
  const loop = (c.doc as any).states.playing.loop["content.opacity"];
  assert.deepEqual(loop, { to: 0, duration: 1.2, ease: [0.25, 0.1, 0.25, 1], keyframes: [{ at: 0.5, value: -0.75 }] });
  const swing = fromCss(css("@keyframes swing { from { transform: rotate(-10deg) } to { transform: rotate(10deg) } }", "swing 1s ease-in-out infinite alternate"), "swing");
  assert.deepEqual(swing.problems, []);
  const l = (swing.doc as any).states.playing.loop["content.rotation"];
  assert.equal(l.duration, 2);
  assert.deepEqual(l.keyframes, [{ at: 0.5, value: 20 }]);
  assert.ok(swing.differences.every((d) => d.max <= d.limit), JSON.stringify(swing.differences));
});

test("from-css repeats a whole count when the cycle ends where it starts", () => {
  const c = fromCss(css("@keyframes nudge { 0%, 100% { transform: translateX(0) } 50% { transform: translateX(6px) } }", "nudge .2s 3 linear"), "nudge");
  assert.deepEqual(c.problems, []);
  assert.equal((c.doc as any).states.shown.enter["content.x"].keyframes.length, 5);
  const jump = fromCss(css("@keyframes grow { from { transform: scale(1) } to { transform: scale(2) } }", "grow .2s 2"), "grow");
  assert.match(jump.problems.join(), /jumps between them/);
});

test("from-css refuses what it can't convert exactly, and says why", () => {
  const reasons = (k: string, a = "x .4s") => fromCss(css(k.replace("@keyframes x", "@keyframes x"), a), "x").problems.join(" | ");
  // A big turn with a translate after it curves the path between frames, past the limit.
  assert.match(reasons("@keyframes x { from { transform: rotate(20deg) translateX(10px) } to { transform: none } }"), /path differs from nudg's/);
  // A rotate after a non-uniform scale skews; the proof says how far a corner leans.
  assert.match(reasons("@keyframes x { from { transform: scale(1.4, .7) rotate(20deg) } to { transform: none } }"), /a corner leans [\d.]+px/);
  assert.match(reasons("@keyframes x { from { opacity: 0 } to { opacity: 1 } }", "x .4s steps(4)"), /steps/);
  assert.match(reasons("@keyframes x { from { box-shadow: 0 0 2px #000, 0 0 4px #000 } to { box-shadow: none } }"), /more than one outer shadow/);
  assert.match(reasons("@keyframes x { from { color: red } to { color: blue } }"), /no nudg property moves "color"/);
  assert.match(reasons("@keyframes x { from { opacity: ${a} } to { opacity: 1 } }"), /only the app knows/);
  assert.match(fromCss("@keyframes x { from { opacity: 0 } to { opacity: 1 } }", "x").problems.join(), /duration is unknown/);
  assert.match(fromCss("", "x").problems.join(), /No @keyframes x/);
  // A translate after an identity rotate is fine.
  assert.deepEqual(reasons("@keyframes x { from { transform: rotate(0) translateX(10px) } to { transform: none } }"), "");
});

test("from-css offers a fitted spring for an overshoot, beside the exact conversion", () => {
  const c = fromCss(css("@keyframes pop { 0% { transform: scale(1) } 30% { transform: scale(1.3) } 55% { transform: scale(.94) } 75% { transform: scale(1.05) } 100% { transform: scale(1) } }", "pop .5s ease-out"), "pop");
  assert.deepEqual(c.problems, []);
  assert.ok(c.doc && c.spring);
  assert.deepEqual(c.spring.properties, ["scale"]);
  const enter = (c.spring.doc as any).states.shown.enter["content.scale"];
  assert.ok(enter.spring && typeof enter.kick === "number", JSON.stringify(enter));
  assert.match(c.spring.summary, /% of its travel/);
  // The exact one is still keyframes.
  assert.ok((c.doc as any).states.shown.enter["content.scale"].keyframes);
});

test("audit points each convertible @keyframes at from-css", () => {
  const a = audit([{ path: "a.css", text: "@keyframes rise { from { transform: translateY(8px) } to { transform: none } }" }]);
  assert.match(a.findings[0].use, /^nudg from-css a\.css rise/);
});

test("from-css reads a transform list back in nudg's order, and proves the path CSS blends", () => {
  // A small turn, then a translate: the translate is turned with it, and the path stays within half a pixel.
  const c = fromCss(css("@keyframes go { 0% { transform: scale(2) rotate(-10deg) } 40% { transform: rotate(2deg) translateX(-4px) } 70% { transform: rotate(-2deg) translateX(4px) } 100% { transform: none } }", "go .9s linear"), "go");
  assert.deepEqual(c.problems, []);
  const x = (c.doc as any).states.shown.enter["content.x"].keyframes;
  assert.ok(Math.abs(x[0].value - -4 * Math.cos((2 * Math.PI) / 180)) < 1e-6, JSON.stringify(x));
  assert.ok(c.differences.every((d) => d.max <= d.limit), JSON.stringify(c.differences));
  // Popping in from a point: scale(0) has no angle to read back, so the parts are read as written.
  const twinkle = fromCss(css("@keyframes tw { 0% { transform: scale(0) rotate(-90deg) } 60% { transform: scale(1.5) rotate(15deg) } 100% { transform: scale(1) rotate(0) } }", "tw .6s"), "tw");
  assert.deepEqual(twinkle.problems, []);
  assert.equal((twinkle.doc as any).values["content.rotation"], -90);
  // Whole turns are kept, so a spin spins.
  const spin = fromCss(css("@keyframes s { to { transform: rotate(1turn) } }", "s 1s linear infinite"), "s");
  assert.deepEqual(spin.problems, []);
  assert.equal((spin.doc as any).states.playing.loop["content.rotation"].to, 360);
});


test("from-css takes values only the app knows, and mixes colors as CSS does", () => {
  const src = "@keyframes glow { from { box-shadow: 0 0 0 color-mix(in srgb, ${V.accent} 80%, transparent) } to { box-shadow: 0 0 16px color-mix(in srgb, ${V.accent} 80%, transparent) } }\n.x { animation: glow ${MS}ms ease-out; }";
  assert.match(fromCss(src, "glow").problems.join(), /--set "V\.accent=…"/);
  const c = fromCss(src, "glow", { values: { "V.accent": "#ff6a00", MS: "400" } });
  assert.deepEqual(c.problems, []);
  // 80% of an opaque color with transparent: the color at 80% alpha (0.8 × 255 = 204, cc).
  assert.equal((c.doc as any).values["content.shadowColor"], "#ff6a00cc");
  assert.equal((c.doc as any).animate["content.shadowBlur"].tween.duration, 0.4);
});

test("from-css reads a shadow's spread and an inset shadow (1.6), and fades to transparent as CSS does", () => {
  const ring = fromCss(css("@keyframes ring { 0% { box-shadow: 0 0 0 0 #ff6a00cc } 100% { box-shadow: 0 0 0 12px transparent } }", "ring .5s ease-out"), "ring");
  assert.deepEqual(ring.problems, []);
  const doc = ring.doc as any;
  assert.equal(doc.states.shown.set["content.shadowSpread"], 12);
  // The transparent end keeps the ring's hue, so it fades without passing through black.
  assert.equal(doc.states.shown.set["content.shadowColor"], "#ff6a0000");
  assert.ok(ring.differences.every((d) => d.max <= (d.unit === "ΔE" ? 0.001 : d.limit)), JSON.stringify(ring.differences));
  const both = fromCss(css("@keyframes press { from { box-shadow: 0 4px 8px #0004, inset 0 0 0 0 #0000 } to { box-shadow: 0 1px 2px #0004, inset 0 2px 4px #0006 } }", "press .2s"), "press");
  assert.deepEqual(both.problems, []);
  assert.equal((both.doc as any).states.shown.set["content.innerBlur"], 4);
});


test("from-css reads the animation option as CSS does: the first time is the duration, the second the delay (#160)", () => {
  const kf = "@keyframes blink { 0%, 100% { opacity: 1 } 50% { opacity: .25 } }";
  // A source line with one time, and an option with two: the option's own first time is the duration.
  const c = fromCss(kf + "\n.x { animation: blink 1.2s infinite; }", "blink", { animation: "blink .9s .3s infinite" });
  const loop = (c.doc as any).states.playing.loop["content.opacity"];
  assert.equal(loop.duration, 0.9);
  assert.equal(loop.delay, 0.3);
  const f = fromCss("@keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }", "fadeIn", { animation: "fadeIn .4s ease .65s both" });
  // A hold of 0.65 s, then 0.4 s of fade: 1.05 s in all, the fade starting at 0.65 / 1.05.
  const enter = (f.doc as any).states.shown.enter["content.opacity"];
  assert.equal(enter.duration, 1.05);
  assert.deepEqual(enter.keyframes, [{ at: 0.619048, value: 0, ease: [0.25, 0.1, 0.25, 1] }]);
  // A source line with two times keeps them when the option gives only an ease.
  const g = fromCss("@keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }\n.x { animation: fadeIn .4s ease .65s both; }", "fadeIn", { animation: "linear" });
  const kept = (g.doc as any).states.shown.enter["content.opacity"];
  assert.equal(kept.duration, 1.05);
  assert.deepEqual(kept.keyframes, [{ at: 0.619048, value: 0 }]);
  assert.equal(kept.ease, "linear");
});
