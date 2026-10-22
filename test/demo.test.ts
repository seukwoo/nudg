// Drives the examples site in headless Chrome the way a visitor would: served by
// demo/serve.mjs from a fresh build. Skipped without a local Chrome.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { findChrome } from "../src/node/chrome.ts";
import { launchBrowser, waitFor, type Browser } from "../src/node/cdp.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const chrome = findChrome();
const skip = chrome ? false : "no Chrome found";

let server: { close(): void; address(): { port: number } | string | null };
let browser: Browser;
let base = "";
const errors: string[] = [];

before(async () => {
  if (!chrome) return;
  execFileSync(process.execPath, [`${root}node_modules/typescript/bin/tsc`, "-p", `${root}tsconfig.build.json`], { stdio: "ignore" });
  const { serve } = await import("../demo/serve.mjs");
  server = await serve(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await launchBrowser(chrome);
  await browser.send("Runtime.enable");
  await browser.send("Page.enable");
  browser.on("Runtime.exceptionThrown", (p: any) => errors.push(p.exceptionDetails.exception?.description ?? p.exceptionDetails.text));
});

after(async () => {
  await browser?.close();
  server?.close();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const go = async (hash: string) => {
  await browser.evaluate(`location.hash = ${JSON.stringify(hash)}`);
  await sleep(600);
};
const mouse = (type: string, x: number, y: number) =>
  browser.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 });
const center = (stage: string, selector: string) =>
  browser.evaluate(
    `(() => { const r = document.getElementById(${JSON.stringify(stage)}).shadowRoot.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`,
  ) as Promise<[number, number]>;

test("the site starts and shows every cataloged example", { skip }, async () => {
  await browser.send("Page.navigate", { url: `${base}/demo/` });
  await waitFor(() => browser.evaluate("window.__nudgStarted === true || undefined"), 10_000);
  const catalog = JSON.parse(await browser.evaluate(`fetch("../examples/index.json").then((r) => r.text())`));
  await waitFor(async () => ((await browser.evaluate("document.querySelectorAll('#grid .state:not(:empty)').length")) >= catalog.examples.length ? true : undefined), 10_000);
  assert.equal(await browser.evaluate("document.querySelectorAll('#grid .card').length"), catalog.examples.length);
  assert.equal(await browser.evaluate("document.getElementById('boot-error').hidden"), true);
  assert.equal(await browser.evaluate("document.querySelectorAll('#categories a').length"), catalog.categories.length + 1);
  assert.equal(await browser.evaluate("document.querySelectorAll('.runtime-platforms [role=listitem]').length"), 4);
  assert.match(await browser.evaluate("document.querySelector('.runtime-check').textContent"), /32 \/ 32.*TypeScript.*Swift.*Kotlin/s);
});

test("no example overflows its card stage, at wide and narrow widths", { skip }, async () => {
  for (const width of [1800, 1100, 390]) {
    await browser.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 800 });
    await sleep(300);
    const overflowing = await browser.evaluate(`[...document.querySelectorAll("#grid .card")].flatMap((card) => {
      const stage = card.querySelector(".stage");
      const s = stage.getBoundingClientRect();
      return [...stage.shadowRoot.children].filter((el) => el.tagName !== "STYLE").map((el) => el.getBoundingClientRect())
        .filter((r) => r.width && (r.left < s.left - 0.5 || r.right > s.right + 0.5 || r.top < s.top - 0.5 || r.bottom > s.bottom + 0.5))
        .map(() => card.querySelector("h3").textContent + " @" + ${width});
    })`);
    assert.deepEqual(overflowing, []);
  }
  await browser.send("Emulation.clearDeviceMetricsOverride");
});

test("filters: category, tag and search", { skip }, async () => {
  await go("#category=lists");
  assert.equal(await browser.evaluate("document.getElementById('browse-title').textContent"), "Lists & rows");
  await go("#tag=kick");
  assert.deepEqual(await browser.evaluate("[...document.querySelectorAll('#grid h3')].map((h) => h.textContent).sort()"), ["Badge", "Like", "Rating", "Stepper"]);
  await go("#tag=keyframes");
  assert.deepEqual(await browser.evaluate("[...document.querySelectorAll('#grid h3')].map((h) => h.textContent)"), ["Shake on error"]);
  await go("#");
  await browser.evaluate(`(() => { const s = document.getElementById("search"); s.value = "sheet"; s.dispatchEvent(new Event("input")); })()`);
  await sleep(300);
  assert.deepEqual(await browser.evaluate("[...document.querySelectorAll('#grid h3')].map((h) => h.textContent)"), ["Bottom sheet"]);
  await browser.evaluate(`(() => { const s = document.getElementById("search"); s.value = ""; s.dispatchEvent(new Event("input")); })()`);
});

test("detail: a drag inside the shadow root, tabs, reset, open in playground", { skip }, async () => {
  await go("#example/swipe-row");
  await waitFor(() => browser.evaluate("document.getElementById('detail-state').textContent || undefined"), 5_000);
  let [x, y] = await center("detail-stage", "[data-nudg=content]");
  await mouse("mousePressed", x, y);
  for (let i = 1; i <= 8; i++) {
    await mouse("mouseMoved", x - i * 10, y);
    await sleep(16);
  }
  await mouse("mouseReleased", x - 80, y);
  await sleep(600);
  assert.equal(await browser.evaluate("document.getElementById('detail-state').textContent"), "open");
  [x, y] = await center("detail-stage", "[data-nudg=action]");
  await mouse("mousePressed", x, y);
  await mouse("mouseReleased", x, y);
  await sleep(500);
  assert.equal(await browser.evaluate("document.getElementById('detail-state').textContent"), "deleted");
  await browser.evaluate("document.getElementById('detail-reset').click()");
  await sleep(200);
  assert.equal(await browser.evaluate("document.getElementById('detail-state').textContent"), "closed");
  assert.equal(await browser.evaluate("document.getElementById('detail-stage').shadowRoot.querySelector('[data-nudg=row]').style.opacity"), "1");

  await browser.evaluate("document.querySelector('[data-tab=react]').click()");
  assert.match(await browser.evaluate("document.getElementById('detail-code').textContent"), /useNudg/);
  await browser.evaluate("document.querySelector('[data-tab=react-native]').click()");
  assert.match(await browser.evaluate("document.getElementById('detail-code').textContent"), /@nudg\/core\/native.*gesture/s);
  await browser.evaluate("document.querySelector('[data-tab=swiftui]').click()");
  assert.match(await browser.evaluate("document.getElementById('detail-code').textContent"), /NudgModel.*nudgPress/s);
  await browser.evaluate("document.querySelector('[data-tab=compose]').click()");
  assert.match(await browser.evaluate("document.getElementById('detail-code').textContent"), /rememberNudg.*nudgKeys/s);
  await browser.evaluate("document.querySelector('[data-tab=nudg]').click()");

  await browser.evaluate("document.getElementById('detail-open').click()");
  await waitFor(() => browser.evaluate("location.hash === '#playground' && document.getElementById('playground-source').value.length > 100 || undefined"), 5_000);
  assert.equal(await browser.evaluate("document.getElementById('playground-example').value"), "swipe-row");
  const total = JSON.parse(await browser.evaluate(`fetch("../examples/index.json").then((r) => r.text())`)).examples.length;
  assert.equal(await browser.evaluate("document.getElementById('playground-example').options.length"), total);
  assert.match(await browser.evaluate("document.getElementById('playground-diagnostics').textContent"), /No problems/);
});

test("voice chat exposes the complete local call surface", { skip }, async () => {
  await go("#example/microphone");
  await waitFor(() => browser.evaluate("document.getElementById('detail-state').textContent === 'ready' ? true : undefined"), 5_000);
  const surface = await browser.evaluate(`(() => {
    const root = document.getElementById("detail-stage").shadowRoot;
    return {
      room: root.querySelector(".room")?.textContent,
      participant: root.querySelector(".identity strong")?.textContent,
      status: root.querySelector(".status")?.value,
      elapsed: root.querySelector("time")?.textContent,
      meter: root.querySelector("[role=meter]")?.getAttribute("aria-valuenow"),
      controls: [...root.querySelectorAll("button")].map((button) => button.textContent),
      muted: root.querySelector(".mute")?.getAttribute("aria-pressed"),
    };
  })()`);
  assert.deepEqual(surface, {
    room: "DESIGN ROOM · 2 PARTICIPANTS",
    participant: "Mina Lee",
    status: "Ready to join",
    elapsed: "00:00",
    meter: "0",
    controls: ["Join voice", "Mute", "Leave"],
    muted: "false",
  });

  await browser.evaluate(`(() => {
    const track = { enabled: true, stopped: false, addEventListener() {}, stop() { this.stopped = true; } };
    window.__voiceTrack = track;
    navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [track], getAudioTracks: () => [track] });
    window.AudioContext = class {
      createAnalyser() { return { fftSize: 0, getFloatTimeDomainData(samples) { samples.fill(0.05); } }; }
      createMediaStreamSource() { return { connect() {} }; }
      close() { return Promise.resolve(); }
    };
    document.getElementById("detail-stage").shadowRoot.querySelector(".join").click();
  })()`);
  await waitFor(() => browser.evaluate("document.getElementById('detail-state').textContent === 'live' ? true : undefined"), 5_000);
  assert.ok(Number(await browser.evaluate("document.getElementById('detail-stage').shadowRoot.querySelector('[role=meter]').getAttribute('aria-valuenow')")) > 0);

  await browser.evaluate("document.getElementById('detail-stage').shadowRoot.querySelector('.mute').click()");
  await waitFor(() => browser.evaluate("document.getElementById('detail-state').textContent === 'muted' ? true : undefined"), 5_000);
  assert.equal(await browser.evaluate("window.__voiceTrack.enabled"), false);
  assert.equal(await browser.evaluate("document.getElementById('detail-stage').shadowRoot.querySelector('.mute').getAttribute('aria-pressed')"), "true");

  await browser.evaluate("document.getElementById('detail-stage').shadowRoot.querySelector('.mute').click()");
  await waitFor(() => browser.evaluate("document.getElementById('detail-state').textContent === 'live' ? true : undefined"), 5_000);
  assert.equal(await browser.evaluate("window.__voiceTrack.enabled"), true);

  await browser.evaluate("document.getElementById('detail-stage').shadowRoot.querySelector('.leave').click()");
  await waitFor(() => browser.evaluate("document.getElementById('detail-state').textContent === 'ready' ? true : undefined"), 5_000);
  assert.equal(await browser.evaluate("window.__voiceTrack.stopped"), true);
  assert.equal(await browser.evaluate("document.getElementById('detail-stage').shadowRoot.querySelector('[role=meter]').getAttribute('aria-valuenow')"), "0");
});

test("video call shares real camera controls without collapsing them into capture", { skip }, async () => {
  await go("#example/video-call");
  await waitFor(() => browser.evaluate("document.getElementById('detail-state').textContent.includes('ready') ? true : undefined"), 5_000);
  assert.deepEqual(
    await browser.evaluate(`(() => {
      const root = document.getElementById("detail-stage").shadowRoot;
      return {
        label: root.querySelector(".video-call")?.getAttribute("aria-label"),
        status: root.querySelector(".status")?.value,
        controls: [...root.querySelectorAll("button")].map((button) => button.textContent),
      };
    })()`),
    { label: "Video call with Mina Lee", status: "Ready to join", controls: ["Join video", "Camera on", "Mute", "Flip", "Leave"] },
  );

  await browser.evaluate(`(() => {
    const makeTrack = (kind) => ({ kind, enabled: true, stopped: false, stop() { this.stopped = true; } });
    window.__cameraRequests = [];
    window.__cameraStreams = [];
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const video = makeTrack("video");
      const audio = makeTrack("audio");
      const stream = new MediaStream();
      Object.assign(stream, { video, audio });
      Object.defineProperties(stream, {
        getTracks: { value: () => [video, audio] },
        getVideoTracks: { value: () => [video] },
        getAudioTracks: { value: () => [audio] },
      });
      window.__cameraRequests.push(constraints);
      window.__cameraStreams.push(stream);
      return stream;
    };
    document.getElementById("detail-stage").shadowRoot.querySelector(".join").click();
  })()`);
  await waitFor(() => browser.evaluate("document.getElementById('detail-state').textContent.includes('live') ? true : undefined"), 5_000);
  assert.deepEqual(
    await browser.evaluate(`(() => { const root = document.getElementById("detail-stage").shadowRoot; const join = root.querySelector(".join"); const actions = root.querySelector(".actions"); return [join.style.visibility, actions.style.visibility, getComputedStyle(join).visibility, getComputedStyle(actions).visibility]; })()`),
    ["hidden", "visible", "hidden", "visible"],
  );
  await waitFor(() => browser.evaluate(`(() => { const root = document.getElementById("detail-stage").shadowRoot; return getComputedStyle(root.querySelector(".join")).opacity === "0" && getComputedStyle(root.querySelector(".actions")).opacity === "1" ? true : undefined; })()`), 5_000);
  assert.deepEqual(
    await browser.evaluate(`(() => { const buttons = [...document.getElementById("detail-stage").shadowRoot.querySelectorAll(".actions button")]; return {
      fontSizes: [...new Set(buttons.map((button) => getComputedStyle(button).fontSize))],
      labelsFit: buttons.every((button) => button.scrollWidth <= button.clientWidth && button.scrollHeight <= button.clientHeight),
    }; })()`),
    { fontSizes: ["10px"], labelsFit: true },
  );

  await browser.evaluate("document.getElementById('detail-stage').shadowRoot.querySelector('.camera').click()");
  await waitFor(() => browser.evaluate("document.getElementById('detail-state').textContent.includes('camera-off') ? true : undefined"), 5_000);
  assert.equal(await browser.evaluate("window.__cameraStreams[0].video.enabled"), false);
  assert.deepEqual(
    await browser.evaluate(`(() => { const button = document.getElementById("detail-stage").shadowRoot.querySelector(".camera"); return [button.textContent, button.getAttribute("aria-pressed")]; })()`),
    ["Camera off", "false"],
  );

  await browser.evaluate("document.getElementById('detail-stage').shadowRoot.querySelector('.mute').click()");
  await waitFor(() => browser.evaluate("document.getElementById('detail-state').textContent.includes('mic-off') ? true : undefined"), 5_000);
  assert.equal(await browser.evaluate("window.__cameraStreams[0].audio.enabled"), false);
  assert.equal(
    await browser.evaluate(`(() => { const buttons = [...document.getElementById("detail-stage").shadowRoot.querySelectorAll(".actions button")]; return buttons.some((button) => button.textContent === "Unmute") && buttons.every((button) => button.scrollWidth <= button.clientWidth && button.scrollHeight <= button.clientHeight); })()`),
    true,
  );

  await browser.evaluate("document.getElementById('detail-stage').shadowRoot.querySelector('.camera').click(); document.getElementById('detail-stage').shadowRoot.querySelector('.flip').click()");
  await waitFor(() => browser.evaluate("window.__cameraRequests.length === 2 && document.getElementById('detail-state').textContent.includes('camera-on') ? true : undefined"), 5_000);
  assert.equal(await browser.evaluate("window.__cameraRequests[1].video.facingMode"), "environment");
  assert.equal(await browser.evaluate("window.__cameraStreams[0].video.stopped"), true);
  assert.deepEqual(
    await browser.evaluate(`(() => { const root = document.getElementById("detail-stage").shadowRoot; const camera = root.querySelector(".camera"); const mute = root.querySelector(".mute"); return [camera.textContent, camera.getAttribute("aria-pressed"), mute.textContent, mute.getAttribute("aria-pressed"), window.__cameraStreams[1].audio.enabled]; })()`),
    ["Camera on", "true", "Unmute", "true", false],
  );

  await browser.evaluate("document.getElementById('detail-stage').shadowRoot.querySelector('.leave').click()");
  await waitFor(() => browser.evaluate("document.getElementById('detail-state').textContent.includes('ready') ? true : undefined"), 5_000);
  assert.equal(await browser.evaluate("window.__cameraStreams[1].video.stopped && window.__cameraStreams[1].audio.stopped"), true);

  await browser.evaluate(`(() => {
    window.__cameraRequests = [];
    window.__cameraStreams = [];
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      window.__cameraRequests.push(constraints);
      if (constraints.audio) throw new DOMException("Microphone denied", "NotAllowedError");
      const video = { enabled: true, stopped: false, stop() { this.stopped = true; } };
      const stream = new MediaStream();
      Object.assign(stream, { video });
      Object.defineProperties(stream, {
        getTracks: { value: () => [video] },
        getVideoTracks: { value: () => [video] },
        getAudioTracks: { value: () => [] },
      });
      window.__cameraStreams.push(stream);
      return stream;
    };
    document.getElementById("detail-stage").shadowRoot.querySelector(".join").click();
  })()`);
  await waitFor(() => browser.evaluate("document.getElementById('detail-state').textContent.includes('live') ? true : undefined"), 5_000);
  assert.deepEqual(await browser.evaluate("window.__cameraRequests.map((request) => request.audio)"), [true, false]);
  assert.equal(await browser.evaluate("document.getElementById('detail-stage').shadowRoot.querySelector('.status').value"), "Connected · camera on · no microphone");
  assert.equal(await browser.evaluate("document.getElementById('detail-stage').shadowRoot.querySelector('.mute').disabled"), true);
  assert.equal(await browser.evaluate("document.getElementById('detail-stage').shadowRoot.querySelector('.mute').getAttribute('aria-label')"), "Microphone unavailable");
  assert.equal(await browser.evaluate("document.getElementById('detail-stage').shadowRoot.querySelector('.mute').textContent"), "No mic");
  assert.equal(await browser.evaluate("document.getElementById('detail-stage').shadowRoot.querySelector('video').srcObject === window.__cameraStreams[0]"), true);
  await browser.evaluate("document.getElementById('detail-stage').shadowRoot.querySelector('.leave').click()");

  await browser.evaluate(`(() => {
    window.__cameraRequests = [];
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      window.__cameraRequests.push(constraints);
      throw new DOMException("Camera denied", "NotAllowedError");
    };
    document.getElementById("detail-stage").shadowRoot.querySelector(".join").click();
  })()`);
  await waitFor(() => browser.evaluate("document.getElementById('detail-state').textContent.includes('live') && document.getElementById('detail-state').textContent.includes('camera-off') ? true : undefined"), 5_000);
  assert.deepEqual(
    await browser.evaluate(`(() => { const root = document.getElementById("detail-stage").shadowRoot; return {
      status: root.querySelector(".status").value,
      controls: [...root.querySelectorAll(".actions button")].map((button) => button.textContent),
      disabled: [root.querySelector(".camera").disabled, root.querySelector(".mute").disabled, root.querySelector(".flip").disabled],
    }; })()`),
    { status: "Joined · camera unavailable", controls: ["Retry camera", "No mic", "Flip", "Leave"], disabled: [false, true, true] },
  );

  await browser.evaluate(`(() => {
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const video = { kind: "video", enabled: true, stop() {} };
      const audio = { kind: "audio", enabled: true, stop() {} };
      const stream = new MediaStream();
      Object.defineProperties(stream, {
        getTracks: { value: () => [video, audio] },
        getVideoTracks: { value: () => [video] },
        getAudioTracks: { value: () => [audio] },
      });
      window.__retryStream = stream;
      return stream;
    };
    document.getElementById("detail-stage").shadowRoot.querySelector(".camera").click();
  })()`);
  await waitFor(() => browser.evaluate("document.getElementById('detail-state').textContent.includes('camera-on') && document.getElementById('detail-state').textContent.includes('mic-on') ? true : undefined"), 5_000);
  assert.deepEqual(
    await browser.evaluate(`(() => { const root = document.getElementById("detail-stage").shadowRoot; return [root.querySelector(".status").value, root.querySelector(".camera").textContent, root.querySelector(".mute").disabled, root.querySelector("video").srcObject === window.__retryStream]; })()`),
    ["Connected · camera on", "Camera on", false, true],
  );
  await browser.evaluate("document.getElementById('detail-stage').shadowRoot.querySelector('.leave').click()");
});

test("camera covers photo, recording and review states", { skip }, async () => {
  await go("#example/camera");
  await waitFor(() => browser.evaluate("document.getElementById('detail-state').textContent === 'idle' ? true : undefined"), 5_000);
  assert.deepEqual(
    await browser.evaluate(`(() => {
      const root = document.getElementById("detail-stage").shadowRoot;
      return {
        label: root.querySelector(".camera-app")?.getAttribute("aria-label"),
        status: root.querySelector(".status")?.value,
        modes: [...root.querySelectorAll(".modes button")].map((button) => button.textContent),
        actions: [root.querySelector(".shutter")?.getAttribute("aria-label"), root.querySelector(".flip")?.textContent, root.querySelector(".retake")?.textContent, root.querySelector(".use")?.textContent],
      };
    })()`),
    { label: "Camera", status: "Camera off", modes: ["Photo", "Video"], actions: ["Take photo", "Flip", "Retake", "Use"] },
  );

  await browser.evaluate(`(() => {
    const makeTrack = (kind) => ({ kind, enabled: true, stopped: false, stop() { this.stopped = true; } });
    navigator.mediaDevices.getUserMedia = async () => {
      const video = makeTrack("video");
      const audio = makeTrack("audio");
      const stream = new MediaStream();
      Object.defineProperties(stream, {
        getTracks: { value: () => [video, audio] },
        getVideoTracks: { value: () => [video] },
        getAudioTracks: { value: () => [audio] },
      });
      return stream;
    };
    window.MediaRecorder = class {
      state = "inactive";
      mimeType = "video/webm";
      constructor(stream) { this.stream = stream; }
      start() { this.state = "recording"; }
      stop() {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob(["frame"], { type: this.mimeType }) });
        this.onstop?.();
      }
    };
    document.getElementById("detail-stage").shadowRoot.querySelector(".start").click();
  })()`);
  await waitFor(() => browser.evaluate("document.getElementById('detail-state').textContent === 'photo' ? true : undefined"), 5_000);
  assert.deepEqual(
    await browser.evaluate(`(() => {
      const root = document.getElementById("detail-stage").shadowRoot;
      const app = root.querySelector(".camera-app").getBoundingClientRect();
      const modes = root.querySelector(".modes").getBoundingClientRect();
      const buttons = [...root.querySelectorAll(".modes button")].map((button) => button.getBoundingClientRect().width);
      const shutter = root.querySelector(".shutter").getBoundingClientRect();
      return {
        modes: modes.width,
        buttons,
        shutterOffset: Math.round((shutter.x + shutter.width / 2) - (app.x + app.width / 2)),
      };
    })()`),
    { modes: 96, buttons: [48, 48], shutterOffset: 0 },
  );

  await browser.evaluate("document.getElementById('detail-stage').shadowRoot.querySelector('.shutter').click()");
  await waitFor(() => browser.evaluate("document.getElementById('detail-state').textContent === 'photo-review' ? true : undefined"), 5_000);
  assert.equal(await browser.evaluate("document.getElementById('detail-stage').shadowRoot.querySelector('.result-photo').style.display"), "block");
  await browser.evaluate("document.getElementById('detail-stage').shadowRoot.querySelector('.retake').click()");
  await waitFor(() => browser.evaluate("document.getElementById('detail-state').textContent === 'photo' ? true : undefined"), 5_000);

  await browser.evaluate("document.getElementById('detail-stage').shadowRoot.querySelector('.video-mode').click(); document.getElementById('detail-stage').shadowRoot.querySelector('.shutter').click()");
  await waitFor(() => browser.evaluate("document.getElementById('detail-state').textContent === 'recording' ? true : undefined"), 5_000);
  assert.equal(await browser.evaluate("document.getElementById('detail-stage').shadowRoot.querySelector('.shutter').getAttribute('aria-label')"), "Start recording");
  await browser.evaluate("document.getElementById('detail-stage').shadowRoot.querySelector('.shutter').click()");
  await waitFor(() => browser.evaluate("document.getElementById('detail-state').textContent === 'video-review' ? true : undefined"), 5_000);
  assert.equal(await browser.evaluate("document.getElementById('detail-stage').shadowRoot.querySelector('.result-video').style.display"), "block");
});

test("music player connects transport controls to real media and nudg inputs", { skip }, async () => {
  await go("#example/music-player");
  await waitFor(() => browser.evaluate("document.getElementById('detail-state').textContent.includes('paused') ? true : undefined"), 5_000);
  assert.deepEqual(
    await browser.evaluate(`(() => {
      const root = document.getElementById("detail-stage").shadowRoot;
      return {
        label: root.querySelector(".music-player").getAttribute("aria-label"),
        title: root.querySelector(".meta strong").textContent,
        artwork: [root.querySelector(".artwork").getAttribute("src"), root.querySelector(".artwork").complete, root.querySelector(".artwork").naturalWidth],
        controls: [".media-back", ".media-toggle", ".media-stop", ".media-forward", ".media-repeat", ".media-mute", ".media-volume", ".media-rate"].every((selector) => root.querySelector(selector)),
        muteLabel: root.querySelector(".media-mute").getAttribute("aria-label"),
      };
    })()`),
    { label: "Music player", title: "Afterglow", artwork: ["../examples/media/afterglow-cover.png", true, 320], controls: true, muteLabel: "Mute" },
  );
  const musicDuration = await browser.evaluate(`(() => { const root = document.getElementById("detail-stage").shadowRoot; return [root.querySelector("audio").duration, root.querySelector(".media-seek").max]; })()`);
  assert.ok(musicDuration[0] > 11 && musicDuration[0] < 13, `audio duration was ${musicDuration[0]}`);
  assert.ok(Number(musicDuration[1]) > 11, `seek max was ${musicDuration[1]}`);

  await browser.evaluate("document.getElementById('detail-stage').shadowRoot.querySelector('audio').muted = true");
  const [musicX, musicY] = await center("detail-stage", ".media-toggle");
  await mouse("mousePressed", musicX, musicY);
  await mouse("mouseReleased", musicX, musicY);
  await waitFor(() => browser.evaluate("document.getElementById('detail-state').textContent.includes('playing') ? true : undefined"), 5_000);
  await waitFor(() => browser.evaluate("document.getElementById('detail-stage').shadowRoot.querySelector('audio').currentTime > 0.2 ? true : undefined"), 2_000);
  await browser.evaluate("document.getElementById('detail-stage').shadowRoot.querySelector('.media-stop').click()");
  await waitFor(() => browser.evaluate("document.getElementById('detail-state').textContent.includes('stopped') ? true : undefined"), 2_000);
  await waitFor(() => browser.evaluate("document.getElementById('detail-stage').shadowRoot.querySelector('.artwork-status').value === 'Stopped' ? true : undefined"), 2_000);
  assert.deepEqual(
    await browser.evaluate(`(() => { const root = document.getElementById("detail-stage").shadowRoot; const audio = root.querySelector("audio"); return [audio.paused, audio.currentTime, root.querySelector(".artwork-status").value]; })()`),
    [true, 0, "Stopped"],
  );

  await browser.evaluate(`(() => {
    const root = document.getElementById("detail-stage").shadowRoot;
    const audio = root.querySelector("audio");
    const seek = root.querySelector(".media-seek");
    seek.value = "6";
    seek.dispatchEvent(new Event("input", { bubbles: true }));
    const volume = root.querySelector(".media-volume");
    volume.value = "0.35";
    volume.dispatchEvent(new Event("input", { bubbles: true }));
    const rate = root.querySelector(".media-rate");
    rate.value = "1.5";
    rate.dispatchEvent(new Event("change", { bubbles: true }));
    root.querySelector(".media-repeat").click();
    window.__musicValues = [audio.currentTime, audio.volume, audio.playbackRate, audio.loop];
  })()`);
  assert.deepEqual(await browser.evaluate("window.__musicValues"), [6, 0.35, 1.5, true]);
  assert.equal(await browser.evaluate("document.getElementById('detail-stage').shadowRoot.querySelector('.media-repeat').getAttribute('aria-pressed')"), "true");
  await browser.evaluate("document.getElementById('detail-reset').click()");
  await waitFor(() => browser.evaluate("document.getElementById('detail-state').textContent.includes('paused') ? true : undefined"), 5_000);
  assert.equal(await browser.evaluate("document.getElementById('detail-stage').shadowRoot.querySelector('audio').getAttribute('src')"), "../examples/media/afterglow.mp3");
});

test("video player exposes playback, auto-hide, PiP and fullscreen controls", { skip }, async () => {
  await go("#example/video-player");
  await waitFor(() => browser.evaluate("document.getElementById('detail-state').textContent.includes('paused') ? true : undefined"), 5_000);
  assert.deepEqual(
    await browser.evaluate(`(() => {
      const root = document.getElementById("detail-stage").shadowRoot;
      return {
        label: root.querySelector(".video-player").getAttribute("aria-label"),
        source: root.querySelector("video").getAttribute("src"),
        dimensions: [root.querySelector("video").videoWidth, root.querySelector("video").videoHeight],
        controls: [".media-toggle", ".media-stop", ".media-seek", ".media-mute", ".media-volume", ".media-rate", ".media-pip", ".media-fullscreen"].every((selector) => root.querySelector(selector)),
      };
    })()`),
    { label: "Video player", source: "../examples/media/color-drift.webm", dimensions: [640, 360], controls: true },
  );

  await browser.evaluate(`(() => {
    const root = document.getElementById("detail-stage").shadowRoot;
    const video = root.querySelector("video");
    video.muted = true;
    root.querySelector("[data-nudg=play]").click();
  })()`);
  await waitFor(() => browser.evaluate("document.getElementById('detail-state').textContent.includes('playing') ? true : undefined"), 5_000);
  await browser.evaluate(`(() => {
    const controls = document.getElementById("detail-stage").shadowRoot.querySelector("[data-nudg=controls]");
    controls.dispatchEvent(new PointerEvent("pointerenter", { pointerType: "mouse" }));
  })()`);
  await sleep(2_500);
  assert.match(await browser.evaluate("document.getElementById('detail-state').textContent"), /timed/, "hover pauses control auto-hide");
  await browser.evaluate(`document.getElementById("detail-stage").shadowRoot.querySelector("[data-nudg=controls]").dispatchEvent(new PointerEvent("pointerleave", { pointerType: "mouse" }))`);
  await waitFor(() => browser.evaluate("document.getElementById('detail-state').textContent.includes('hidden') ? true : undefined"), 4_000);
  await browser.evaluate(`(() => {
    const root = document.getElementById("detail-stage").shadowRoot;
    const shell = root.querySelector(".video-player");
    const video = root.querySelector("video");
    shell.requestFullscreen = () => { window.__fullscreenRequested = true; };
    video.requestPictureInPicture = async () => { window.__pipRequested = true; };
    root.querySelector(".media-fullscreen").click();
    root.querySelector(".media-pip").click();
    shell.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
  })()`);
  await waitFor(() => browser.evaluate("document.getElementById('detail-state').textContent.includes('timed') ? true : undefined"), 2_000);
  assert.deepEqual(await browser.evaluate("[window.__fullscreenRequested, window.__pipRequested]"), [true, true]);
  await browser.evaluate("document.getElementById('detail-stage').shadowRoot.querySelector('.media-stop').click()");
  await waitFor(() => browser.evaluate("document.getElementById('detail-state').textContent.includes('stopped') ? true : undefined"), 2_000);
  await waitFor(() => browser.evaluate("document.getElementById('detail-stage').shadowRoot.querySelector('.video-status').value === 'Stopped' ? true : undefined"), 2_000);
  assert.deepEqual(
    await browser.evaluate(`(() => { const root = document.getElementById("detail-stage").shadowRoot; const video = root.querySelector("video"); return [video.paused, video.currentTime, root.querySelector(".video-status").value]; })()`),
    [true, 0, "Stopped"],
  );
});

test("playground: a typo gets a hint; a pasted file gets generic boxes", { skip }, async () => {
  await go("#playground");
  await browser.evaluate("(() => { const p = document.getElementById('playground-example'); p.value = 'toggle'; p.dispatchEvent(new Event('change')); })()");
  await waitFor(() => browser.evaluate("document.getElementById('playground-source').value.includes('knob.x') ? true : undefined"), 5_000);
  await browser.evaluate(`(() => { const t = document.getElementById("playground-source"); t.value = t.value.replace('"set"', '"sett"'); t.dispatchEvent(new Event("input")); })()`);
  await sleep(500);
  assert.match(await browser.evaluate("document.getElementById('playground-diagnostics').textContent"), /Did you mean "set"/);
  await browser.evaluate(`(() => { const t = document.getElementById("playground-source"); t.value = JSON.stringify({ nudg: "0.1", targets: ["ball"], values: { "ball.y": 0 }, initial: "a", states: { a: { when: { "ball.tap": "b" } }, b: { set: { "ball.y": -20 } } } }); t.dispatchEvent(new Event("input")); })()`);
  await sleep(500);
  assert.equal(await browser.evaluate("document.getElementById('playground-stage').shadowRoot.querySelectorAll('.target').length"), 1);
});

test("keys, timers and commit on the site: slider arrows, tooltip delay, dialog Escape", { skip }, async () => {
  const key = (sel: string, k: string) =>
    browser.evaluate(`document.getElementById('detail-stage').shadowRoot.querySelector(${JSON.stringify(sel)}).dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true }))`);
  const tx = (sel: string) =>
    browser.evaluate(`(() => { const t = document.getElementById('detail-stage').shadowRoot.querySelector(${JSON.stringify(sel)}).style.transform; const i = t.indexOf("translate(") + 10; return i > 9 ? Number(t.slice(i, t.indexOf("px", i))) : null; })()`);

  await go("#example/slider");
  await waitFor(() => browser.evaluate("document.getElementById('detail-state').textContent || undefined"), 5_000);
  assert.equal(await tx("[data-nudg=thumb]"), 60);
  const prevented = !(await key("[data-nudg=thumb]", "ArrowRight"));
  assert.equal(prevented, true, "a handled key is prevented from scrolling the page");
  await sleep(500);
  assert.ok(Math.abs((await tx("[data-nudg=thumb]")) - 80) < 0.5, "ArrowRight stepped the thumb by 20");
  await key("[data-nudg=thumb]", "End");
  await sleep(500);
  assert.ok(Math.abs((await tx("[data-nudg=thumb]")) - 200) < 0.5, "End clamps to max");
  assert.equal(await browser.evaluate("document.getElementById('detail-stage').shadowRoot.querySelector('[role=slider]').getAttribute('aria-valuenow')"), "100");
  const unhandled = await key("[data-nudg=thumb]", "a");
  assert.equal(unhandled, true, "an unhandled key keeps its default");

  await go("#example/tooltip");
  await waitFor(() => browser.evaluate("document.getElementById('detail-state').textContent || undefined"), 5_000);
  const [hx, hy] = await center("detail-stage", "[data-nudg=trigger]");
  await browser.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: hx, y: hy });
  assert.match(await browser.evaluate("document.getElementById('detail-state').textContent"), /^(waiting|shown)$/);
  await waitFor(() => browser.evaluate("document.getElementById('detail-state').textContent === 'shown' ? true : undefined"), 1_500);
  assert.equal(await browser.evaluate("document.getElementById('detail-state').textContent"), "shown", "the timer fired and the site noticed");
  await browser.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5 });
  await sleep(200);
  assert.equal(await browser.evaluate("document.getElementById('detail-state').textContent"), "hidden");

  await go("#example/dialog");
  await waitFor(() => browser.evaluate("document.getElementById('detail-state').textContent || undefined"), 5_000);
  const [ox, oy] = await center("detail-stage", "[data-nudg=opener]");
  await mouse("mousePressed", ox, oy);
  await mouse("mouseReleased", ox, oy);
  await sleep(300);
  assert.equal(await browser.evaluate("document.getElementById('detail-state').textContent"), "open");
  assert.equal(await browser.evaluate("document.getElementById('detail-stage').shadowRoot.activeElement?.className"), "close", "focus moved into the dialog");
  await key(".close", "Escape");
  await sleep(300);
  assert.equal(await browser.evaluate("document.getElementById('detail-state').textContent"), "closed");
});

test("bound elements carry the active state, so CSS can animate by state", { skip }, async () => {
  await go("#example/pull-to-refresh");
  await waitFor(() => browser.evaluate("document.getElementById('detail-state').textContent || undefined"), 5_000);
  const spinner = "document.getElementById('detail-stage').shadowRoot.querySelector('[data-nudg=spinner]')";
  assert.equal(await browser.evaluate(`${spinner}.dataset.nudgState`), "idle");
  assert.equal(await browser.evaluate(`getComputedStyle(${spinner}).animationName`), "none");
  const [x, y] = await center("detail-stage", "[data-nudg=list]");
  await mouse("mousePressed", x, y);
  for (let i = 1; i <= 8; i++) {
    await mouse("mouseMoved", x, y + i * 9);
    await sleep(16);
  }
  await mouse("mouseReleased", x, y + 72);
  await sleep(300);
  assert.equal(await browser.evaluate(`${spinner}.dataset.nudgState`), "refreshing");
  assert.equal(await browser.evaluate(`getComputedStyle(${spinner}).animationName`), "ptr-spin");
  await sleep(1800);
  assert.equal(await browser.evaluate(`${spinner}.dataset.nudgState`), "idle", "the demo's app hook sends host.done");
});

test("no page errors were thrown", { skip }, () => {
  assert.deepEqual(errors, []);
});

test("playground compare: the original plays beside the edit, a tap reaches both, and the verdict speaks", { skip }, async () => {
  await go("#example/toggle");
  await browser.evaluate("document.getElementById('detail-compare').click()");
  await waitFor(() => browser.evaluate("location.hash === '#playground' && !document.getElementById('playground-a').hidden && document.getElementById('playground-stage-a').shadowRoot?.querySelector('[data-nudg=track]') ? 'ready' : ''"), 5_000);
  assert.equal(await browser.evaluate("document.getElementById('playground').classList.contains('compare')"), true);
  assert.match(await browser.evaluate("document.getElementById('playground-verdict').textContent"), /Interact with either stage/);
  // Make the edit bouncier, then tap the edited stage: the original must follow.
  await browser.evaluate(`(() => { const t = document.getElementById("playground-source"); t.value = t.value.replace(/"bounce":\\s*[\\d.]+/, '"bounce": 0.7'); t.dispatchEvent(new Event("input")); })()`);
  await sleep(500);
  await browser.evaluate("document.getElementById('playground-stage').shadowRoot.querySelector('[data-nudg=track]').click()");
  await waitFor(() => browser.evaluate("document.getElementById('playground-verdict').dataset.verdict || ''"), 5_000);
  const states = await browser.evaluate("[document.getElementById('playground-state').textContent, document.getElementById('playground-state-a').textContent]");
  assert.deepEqual(states, ["on", "on"], "the tap reached both stages");
  const verdict = await browser.evaluate("document.getElementById('playground-verdict').textContent");
  assert.match(verdict, /change/, verdict);
  // Slow motion remounts both; the interaction so far still stands, so the verdict stays,
  // and a second tap after the remount lands later on the same timeline, not on top of the first.
  await browser.evaluate("(() => { const s = document.getElementById('playground-speed'); s.value = '0.25'; s.dispatchEvent(new Event('change')); })()");
  await sleep(400);
  assert.match(await browser.evaluate("document.getElementById('playground-verdict').textContent"), /A clear change/);
  await browser.evaluate("document.getElementById('playground-stage').shadowRoot.querySelector('[data-nudg=track]').click()");
  await sleep(700);
  assert.match(await browser.evaluate("document.getElementById('playground-verdict').textContent"), /A clear change/, "two taps on one timeline still differ");
  // The remount started both at "off" again; the tap switched both on.
  assert.deepEqual(await browser.evaluate("[document.getElementById('playground-state').textContent, document.getElementById('playground-state-a').textContent]"), ["on", "on"]);
  // Switching the example clears the session.
  await browser.evaluate("(() => { const p = document.getElementById('playground-example'); p.value = 'dialog'; p.dispatchEvent(new Event('change')); })()");
  await sleep(700);
  assert.match(await browser.evaluate("document.getElementById('playground-verdict').textContent"), /Interact with either stage/);
  // No horizontal overflow on a phone in compare mode.
  await browser.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(300);
  assert.ok((await browser.evaluate("document.documentElement.scrollWidth")) <= 390, "no horizontal scroll at 390px");
  await browser.send("Emulation.clearDeviceMetricsOverride");
  await browser.evaluate("(() => { const p = document.getElementById('playground-example'); p.value = 'toggle'; p.dispatchEvent(new Event('change')); })()");
  await sleep(700);
  // Reset clears it.
  await browser.evaluate("document.getElementById('playground-reset').click()");
  assert.match(await browser.evaluate("document.getElementById('playground-verdict').textContent"), /Interact with either stage/);
  // Back to plain mode: one stage again.
  await browser.evaluate("document.getElementById('playground-compare').click()");
  await sleep(300);
  assert.equal(await browser.evaluate("document.getElementById('playground-a').hidden"), true);
  assert.deepEqual(errors, []);
});
