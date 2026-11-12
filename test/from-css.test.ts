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
  assert.match(reasons("@keyframes x { from { transform: rotate(20deg) translateX(10px) } to { transform: none } }"), /translate after a rotate/);
  assert.match(reasons("@keyframes x { from { opacity: 0 } to { opacity: 1 } }", "x .4s steps(4)"), /steps/);
  assert.match(reasons("@keyframes x { from { box-shadow: 0 0 0 0 #000 } to { box-shadow: 0 0 0 12px #0000 } }"), /spread/);
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
