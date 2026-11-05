// The messenger example (examples/apps/messenger), built and used in headless Chrome the
// way a person would: open a chat, swipe to reply, send, react, scroll up, archive; then
// record, cancel, lock and send voice and round video messages, and play them. Headless
// Chrome has no microphone or camera, so the app records along its stand-in and says so.
// Skipped without a local Chrome.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { launchBrowser, waitFor, type Browser } from "../src/node/cdp.ts";
import { findChrome } from "../src/node/chrome.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const chrome = findChrome();
const skip = chrome ? false : "no Chrome found";

let server: { close(): void; address(): { port: number } | string | null };
let browser: Browser;
const errors: string[] = [];

before(async () => {
  if (!chrome) return;
  execFileSync("npm", ["run", "--silent", "messenger"], { cwd: root, stdio: "ignore" });
  const { serve } = await import("../demo/serve.mjs");
  server = await serve(0);
  browser = await launchBrowser(chrome);
  await browser.send("Runtime.enable");
  browser.on("Runtime.exceptionThrown", (p: any) => errors.push(p.exceptionDetails.exception?.description ?? p.exceptionDetails.text));
  // A short phone, so the chat scrolls.
  await browser.send("Emulation.setDeviceMetricsOverride", { width: 400, height: 560, deviceScaleFactor: 1, mobile: false });
  await browser.send("Page.enable");
  await browser.send("Page.navigate", { url: `http://127.0.0.1:${(server.address() as { port: number }).port}/examples/apps/messenger/` });
  await waitFor(() => browser.evaluate(`document.querySelector(".chat-content") ? "ok" : ""`), 15_000);
});

after(async () => {
  await browser?.close();
  server?.close();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const count = (selector: string): Promise<number> => browser.evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
const center = (selector: string, i: number): Promise<[number, number]> =>
  browser.evaluate(`(() => { const r = document.querySelectorAll(${JSON.stringify(selector)})[${i}].getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
const mouse = (type: string, x: number, y: number) => browser.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 });
const drag = async (selector: string, i: number, dx: number) => {
  const [x, y] = await center(selector, i);
  await mouse("mousePressed", x, y);
  for (let k = 1; k <= 12; k++) {
    await mouse("mouseMoved", x + (dx * k) / 12, y);
    await sleep(16);
  }
  await mouse("mouseReleased", x + dx, y);
};
const opacity = (selector: string): Promise<number> => browser.evaluate(`Number(getComputedStyle(document.querySelector(${JSON.stringify(selector)})).opacity)`);

test("messenger: open a chat, reply by swiping, send, get an answer, react, archive", { skip }, async () => {
  await browser.evaluate(`document.querySelector(".chat-content").click()`);
  await sleep(700);
  assert.equal(await browser.evaluate(`Math.round(document.querySelector(".chat-screen").getBoundingClientRect().x)`), 0, "the chat slid in");

  // Swiping a message left past the reply point starts a reply to it.
  const before = await count(".bubble");
  await drag(".bubble", before - 2, -80);
  await sleep(400);
  assert.equal(await count(".reply-bar"), 1);
  assert.equal(await browser.evaluate(`document.querySelector(".reply-text").textContent`), await browser.evaluate(`document.querySelectorAll(".bubble")[${before - 2}].querySelector(":scope > span").textContent`));

  // Typing turns the microphone into send; sending adds the message with its quote.
  await browser.evaluate(`(() => { const i = document.querySelector(".composer input"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "Sounds good"); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await sleep(400);
  assert.ok((await opacity(".composer button[type=submit]")) > 0.9 && (await opacity(".composer-action button[type=button]")) < 0.1, "send is showing, not the microphone");
  // A real click where the send button shows, so whatever covers it would take the click instead.
  const [sx, sy] = await center(".composer button[type=submit]", 0);
  await mouse("mousePressed", sx, sy);
  await mouse("mouseReleased", sx, sy);
  await sleep(1200);
  assert.equal(await count(".bubble .quote"), 1);
  assert.equal(await count(".typing"), 1, "the other side is typing");
  await sleep(2000);
  assert.equal(await count(".typing"), 0);
  assert.equal(await count(".bubble:not(.typing)"), before + 2, "and answered");
  // Rows that opened while their bubble was still rising fit the bubble, not its motion.
  const misfit = await browser.evaluate(`JSON.stringify([...document.querySelectorAll(".row")].map((r) => [r.offsetHeight, r.firstElementChild.offsetHeight]).filter(([a, b]) => Math.abs(a - b) > 1))`);
  assert.equal(misfit, "[]");

  // A long press opens the reactions over the message; picking one adds it, and the row grows to fit.
  const [x, y] = await center(".row.me .bubble", (await count(".row.me .bubble")) - 1);
  await mouse("mousePressed", x, y);
  await sleep(800);
  await mouse("mouseReleased", x, y);
  await sleep(300);
  assert.ok((await opacity(".reaction-bar")) > 0.9, "the picker is open");
  await browser.evaluate(`document.querySelector(".reaction-bar button").click()`);
  await sleep(600);
  assert.ok((await opacity(".reaction-bar")) < 0.1, "and closed after the pick");
  const [h, natural] = await browser.evaluate(`(() => { const r = document.querySelector(".reactions-chip").closest(".row"); return [r.offsetHeight, r.scrollHeight]; })()`);
  assert.ok(Math.abs(h - natural) <= 1, `the row fits its reaction: ${h} vs ${natural}`);

  // Scrolled up, the jump-to-latest button appears.
  await browser.evaluate(`document.querySelector(".messages").scrollTop = 0`);
  await sleep(500);
  assert.ok((await opacity(".jump")) > 0.9, `jump button shown: ${await browser.evaluate(`(() => { const s = document.querySelector(".messages"); return [s.scrollHeight, s.clientHeight, s.scrollTop].join(" "); })()`)}`);

  // Back, then swipe a chat away and archive it.
  await browser.evaluate(`document.querySelector(".back").click()`);
  await sleep(800);
  const chats = await count(".chat-row");
  await drag(".chat-content", 1, -150);
  await sleep(500);
  await browser.evaluate(`document.querySelectorAll(".archive")[1].click()`);
  await sleep(1200);
  assert.equal(await count(".chat-row"), chats - 1);
  assert.deepEqual(errors, []);
});

const voices = () => count(".voice");
const rounds = () => count(".round");
const hold = async (ms: number, path: [number, number][] = []) => {
  const [x, y] = await center(".record-hit", 0);
  await mouse("mousePressed", x, y);
  await sleep(ms);
  for (const [dx, dy] of path) {
    await mouse("mouseMoved", x + dx, y + dy);
    await sleep(16);
  }
  const [dx, dy] = path.at(-1) ?? [0, 0];
  await mouse("mouseReleased", x + dx, y + dy);
};
const steps = (dx: number, dy: number) => Array.from({ length: 12 }, (_, k): [number, number] => [(dx * (k + 1)) / 12, (dy * (k + 1)) / 12]);

test("messenger: hold to record, slide to cancel, slide up to lock, round video, playback", { skip }, async () => {
  await browser.evaluate(`document.querySelector(".chat-content").click()`);
  await sleep(800);
  const [v, r] = [await voices(), await rounds()];

  // Held and let go: a voice message.
  await hold(900);
  await sleep(900);
  assert.equal(await voices(), v + 1, "held and released, it sends");
  const notice = () => browser.evaluate(`(() => { const n = document.querySelector(".record-notice"); return n.hidden ? "" : n.textContent; })()`);
  assert.match(await notice(), /stand-in/, "without a microphone, it says it records a stand-in");

  // Let go while the browser is still asking for the microphone: nothing is sent, and it says why.
  await browser.evaluate(`(() => {
    const md = navigator.mediaDevices;
    window.__gum = md.getUserMedia;
    md.getUserMedia = () => new Promise((_, no) => setTimeout(() => no(new DOMException("denied", "NotAllowedError")), 700));
  })()`);
  await hold(300);
  await sleep(1000);
  assert.equal(await voices(), v + 1, "a hold that ended at the prompt records nothing");
  assert.match(await notice(), /blocked/);
  await browser.evaluate(`navigator.mediaDevices.getUserMedia = window.__gum`);

  // Slid left past the cancel point: nothing is sent, and the bar leaves.
  await hold(400, steps(-160, 0));
  await sleep(600);
  assert.equal(await voices(), v + 1, "slid left, it is discarded");
  assert.ok((await opacity(".record-panel")) < 0.1);

  // Slid up past the lock: recording goes on after the finger lifts; Cancel shows, and a tap sends.
  await hold(400, steps(0, -110));
  await sleep(600);
  assert.ok((await opacity(".record-panel")) > 0.9 && (await opacity(".record-stop")) > 0.9, "locked: still recording, with Cancel");
  await browser.evaluate(`document.querySelector(".record-hit").click()`);
  await sleep(900);
  assert.equal(await voices(), v + 2, "a tap sends the locked recording");

  // After recording, typed text still sends from the send button.
  const texts = await count(".bubble > span");
  await browser.evaluate(`(() => { const i = document.querySelector(".composer input"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "And text"); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await sleep(400);
  const [sx, sy] = await center(".composer button[type=submit]", 0);
  await mouse("mousePressed", sx, sy);
  await mouse("mouseReleased", sx, sy);
  await sleep(900);
  assert.equal(await count(".bubble > span"), texts + 1, "the send button sends");

  // A quick tap switches to round video; held, the round preview grows, and it sends a round.
  await hold(30);
  await sleep(400);
  assert.ok((await opacity(".mode-icon:nth-child(2)")) > 0.9, "the camera shows");
  assert.match(await notice(), /Round video: hold to record/, "and it says how to record");
  await hold(1200);
  await sleep(1200);
  assert.equal(await rounds(), r + 1, "a round video message");

  // Playing the round grows it and fills its ring; at the end it shrinks back.
  const size = () => browser.evaluate(`[...document.querySelectorAll(".row.me .round")].at(-1).offsetWidth`);
  await browser.evaluate(`[...document.querySelectorAll(".row.me .round")].at(-1).click()`);
  await sleep(600);
  assert.ok((await size()) > 240, `playing, it grows: ${await size()}`);
  await sleep(2000);
  assert.ok((await size()) < 210, `ended, it shrinks back: ${await size()}`);

  // Swiping a round left replies to it without playing it.
  await browser.evaluate(`document.querySelector(".messages").scrollTop = 0`);
  await sleep(300);
  const first = await browser.evaluate(`[...document.querySelectorAll(".bubble")].findIndex((b) => b.querySelector(".round"))`);
  await browser.evaluate(`document.querySelectorAll(".bubble")[${first}].scrollIntoView({ block: "center" })`);
  await sleep(300);
  await drag(".bubble", first, -80);
  await sleep(600);
  assert.equal(await browser.evaluate(`document.querySelector(".reply-text").textContent`), "Video message");
  assert.ok((await browser.evaluate(`document.querySelectorAll(".bubble")[${first}].querySelector(".round").offsetWidth`)) < 210, "and doesn't play it");

  // The unheard voice message plays: the dot goes, the waveform fills.
  await browser.evaluate(`document.querySelector(".row.them .voice-toggle").click()`);
  await sleep(1500);
  assert.ok((await opacity(".row.them .unheard")) < 0.1);
  const filled = await browser.evaluate(`document.querySelector(".row.them .wave-fill").offsetWidth`);
  assert.ok(filled > 20 && filled < 138, `the waveform fills as it plays: ${filled}`);
  assert.deepEqual(errors, []);
});
