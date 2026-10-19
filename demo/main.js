// The examples site. Run `npm run demo` and open http://localhost:8787/demo/
//
// Everything comes from ../examples/index.json: each example's nudg file is compiled
// and played on its host page's markup, which lives in a shadow root so the pages'
// styles can't collide with each other or with this site.

import { compileText, compileUrl, play } from "../dist/dom/index.js";
import { compare } from "../dist/index.js";
import { createCameraController } from "../examples/camera-host.js";

const catalog = await fetch("../examples/index.json").then((r) => r.json());
const examples = catalog.examples;
const byId = new Map(examples.map((e) => [e.id, e]));

// --- loading ---------------------------------------------------------------------

const programs = new Map();
const sources = new Map();
const pages = new Map();

/** Compiles an example's file (once) and fetches its source text. */
async function load(ex) {
  if (!programs.has(ex.id)) {
    const url = `../examples/${ex.id}.nudg.json`;
    const [result, text] = await Promise.all([compileUrl(url), fetch(url).then((r) => r.text())]);
    programs.set(ex.id, result);
    sources.set(ex.id, text);
  }
  return { ...programs.get(ex.id), source: sources.get(ex.id) };
}

/** A host page's style and markup, without its scripts. */
async function page(file) {
  if (!pages.has(file)) {
    const html = await fetch(`../examples/${file}`).then((r) => r.text());
    const doc = new DOMParser().parseFromString(html, "text/html");
    const style = [...doc.querySelectorAll("style")].map((s) => s.textContent).join("\n");
    doc.querySelectorAll("script").forEach((s) => s.remove());
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_COMMENT);
    const comments = [];
    while (walker.nextNode()) comments.push(walker.currentNode);
    comments.forEach((c) => c.remove());
    pages.set(file, { style, markup: doc.body.innerHTML.trim() });
  }
  return pages.get(file);
}

// --- playing ---------------------------------------------------------------------

/**
 * App-side behavior some examples need, since the host page's own script doesn't run
 * here: the events an app would send, wired to the example's controls.
 */
const HOOKS = {
  shake(player, root) {
    const form = root.querySelector("form");
    const input = root.querySelector("input");
    form?.addEventListener("submit", (e) => {
      e.preventDefault();
      player.send(input.value.includes("@") ? "host.valid" : "host.invalid");
    });
    input?.addEventListener("input", () => player.send("host.valid"));
  },
  // App timers follow the player's clock (`speed`), and die with the player.
  toast(player, root, { after }) {
    let cancel;
    root.querySelector(".toast-show")?.addEventListener("click", () => {
      player.send("host.show");
      cancel?.();
      cancel = after(2500, () => player.send("host.hide"));
    });
  },
  "pull-to-refresh": (player, root, { after }) => ({
    onState: (state) => state.includes("refreshing") && after(1500, () => player.send("host.done")),
  }),
  // WAI-ARIA dialog: focus moves into the dialog when it opens and back to the opener when it closes.
  dialog: (player, root) => ({
    onState: (state) => root.querySelector(state.includes("open") ? ".close" : ".opener")?.focus({ preventScroll: true }),
  }),
  microphone(player, root) {
    const join = root.querySelector(".join");
    const mute = root.querySelector(".mute");
    const leave = root.querySelector(".leave");
    const status = root.querySelector(".status");
    const elapsed = root.querySelector("time");
    const meter = root.querySelector("[role=meter]");
    let context;
    let stream;
    let frame = 0;
    let timer = 0;
    let started = 0;
    let muted = false;
    let alive = true;

    const showTime = () => {
      const seconds = Math.floor((performance.now() - started) / 1000);
      elapsed.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
      elapsed.dateTime = `PT${seconds}S`;
    };
    const stopAudio = (message = "Call ended", send = true) => {
      cancelAnimationFrame(frame);
      clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
      context?.close().catch(() => {});
      stream = undefined;
      context = undefined;
      muted = false;
      player.input("host.volume", 0);
      if (send) player.send("host.leave");
      status.value = message;
      elapsed.textContent = "00:00";
      elapsed.dateTime = "PT0S";
      meter.setAttribute("aria-valuenow", "0");
    };
    const syncState = (state) => {
      const connecting = state.includes("connecting");
      const active = state.includes("live") || state.includes("muted");
      join.disabled = connecting;
      join.textContent = connecting ? "Connecting..." : active ? "In call" : "Join voice";
      mute.setAttribute("aria-pressed", String(state.includes("muted")));
      mute.textContent = state.includes("muted") ? "Unmute" : "Mute";
    };

    join?.addEventListener("click", async () => {
      if (stream) return;
      player.send("host.connect");
      status.value = "Connecting microphone";
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!alive) return stream.getTracks().forEach((track) => track.stop());
        context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        context.createMediaStreamSource(stream).connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        stream.getAudioTracks()[0].addEventListener("ended", () => stopAudio("Microphone disconnected"), { once: true });
        status.value = "Connected · microphone on";
        player.send("host.connected");
        started = performance.now();
        showTime();
        timer = setInterval(showTime, 1000);
        const update = () => {
          if (!alive) return;
          analyser.getFloatTimeDomainData(samples);
          const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
          const volume = muted ? 0 : Math.min(1, rms * 8);
          player.input("host.volume", volume);
          meter.setAttribute("aria-valuenow", String(Math.round(volume * 100)));
          frame = requestAnimationFrame(update);
        };
        update();
      } catch {
        stopAudio("Microphone unavailable");
        player.send("host.failed");
      }
    });
    mute?.addEventListener("click", () => {
      const track = stream?.getAudioTracks()[0];
      if (!track) return;
      muted = !muted;
      track.enabled = !muted;
      if (muted) player.input("host.volume", 0);
      player.send(muted ? "host.mute" : "host.unmute");
      status.value = muted ? "Connected · microphone muted" : "Connected · microphone on";
    });
    leave?.addEventListener("click", () => stopAudio());
    return {
      onState: syncState,
      dispose() {
        alive = false;
        stopAudio("", false);
      },
    };
  },
  "video-call"(player, root) {
    const video = root.querySelector("video");
    const join = root.querySelector(".join");
    const camera = root.querySelector(".camera");
    const mute = root.querySelector(".mute");
    const flip = root.querySelector(".flip");
    const status = root.querySelector(".status");
    const elapsed = root.querySelector("time");
    const media = createCameraController(video, { audio: true });
    let cameraOn = true;
    let micOn = true;
    let timer = 0;
    let started = 0;
    let alive = true;

    const showTime = () => {
      const seconds = Math.floor((performance.now() - started) / 1000);
      elapsed.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
      elapsed.dateTime = `PT${seconds}S`;
    };
    const reset = (message = "Call ended", send = true) => {
      clearInterval(timer);
      media.stop();
      cameraOn = true;
      micOn = true;
      if (send) {
        player.send("host.camera-on");
        player.send("host.unmute");
        player.send("host.leave");
      }
      status.value = message;
      elapsed.textContent = "00:00";
      elapsed.dateTime = "PT0S";
      camera.setAttribute("aria-pressed", "false");
      mute.setAttribute("aria-pressed", "false");
    };

    join?.addEventListener("click", async () => {
      if (media.stream) return;
      player.send("host.connect");
      status.value = "Connecting camera";
      try {
        await media.start();
        if (!alive) return media.stop();
        player.send("host.connected");
        status.value = "Connected · camera on";
        started = performance.now();
        showTime();
        timer = setInterval(showTime, 1000);
      } catch {
        reset("Camera or microphone unavailable");
        player.send("host.failed");
      }
    });
    camera?.addEventListener("click", () => {
      cameraOn = !cameraOn;
      media.setVideoEnabled(cameraOn);
      player.send(cameraOn ? "host.camera-on" : "host.camera-off");
      camera.setAttribute("aria-pressed", String(!cameraOn));
      status.value = cameraOn ? "Connected · camera on" : "Connected · camera off";
    });
    mute?.addEventListener("click", () => {
      micOn = !micOn;
      media.setAudioEnabled(micOn);
      player.send(micOn ? "host.unmute" : "host.mute");
      mute.setAttribute("aria-pressed", String(!micOn));
    });
    flip?.addEventListener("click", async () => {
      player.send("host.flip");
      flip.disabled = true;
      try {
        await media.switchFacing();
        player.send("host.flipped");
      } catch {
        player.send("host.failed");
        status.value = "Could not switch camera";
      }
      flip.disabled = false;
    });
    root.querySelector(".leave")?.addEventListener("click", () => reset());
    return {
      dispose() {
        alive = false;
        reset("", false);
      },
    };
  },
  camera(player, root) {
    const preview = root.querySelector(".preview");
    const photo = root.querySelector(".result-photo");
    const recorded = root.querySelector(".result-video");
    const status = root.querySelector(".status");
    const recording = root.querySelector(".recording");
    const shutter = root.querySelector(".shutter");
    const photoMode = root.querySelector(".photo-mode");
    const videoMode = root.querySelector(".video-mode");
    const media = createCameraController(preview, { audio: true });
    let mode = "photo";
    let recorder;
    let chunks = [];
    let timer = 0;
    let started = 0;
    let alive = true;

    const setMode = (next) => {
      mode = next;
      player.send(`host.${next}`);
      photoMode.setAttribute("aria-pressed", String(next === "photo"));
      videoMode.setAttribute("aria-pressed", String(next === "video"));
      shutter.setAttribute("aria-label", next === "photo" ? "Take photo" : "Start recording");
    };
    const showPreview = () => {
      photo.style.display = "none";
      recorded.style.display = "none";
      preview.style.display = "block";
    };

    root.querySelector(".start")?.addEventListener("click", async () => {
      player.send("host.start");
      status.value = "Requesting camera";
      try {
        await media.start();
        if (!alive) return media.stop();
        player.send("host.ready");
        status.value = "Camera ready";
      } catch {
        player.send("host.failed");
        status.value = "Camera unavailable";
      }
    });
    photoMode?.addEventListener("click", () => setMode("photo"));
    videoMode?.addEventListener("click", () => setMode("video"));
    root.querySelector(".flip")?.addEventListener("click", async () => {
      status.value = "Switching camera";
      try {
        await media.switchFacing();
        status.value = "Camera ready";
      } catch {
        status.value = "Could not switch camera";
      }
    });
    shutter?.addEventListener("click", () => {
      if (mode === "photo") {
        media.capture(photo);
        preview.style.display = "none";
        photo.style.display = "block";
        player.send("host.capture");
        status.value = "Photo captured";
        return;
      }
      if (recorder?.state === "recording") return recorder.stop();
      if (!media.stream || typeof MediaRecorder === "undefined") {
        status.value = "Recording unavailable";
        return;
      }
      chunks = [];
      recorder = new MediaRecorder(media.stream);
      recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
      recorder.onstop = () => {
        clearInterval(timer);
        recorded.src = URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType || "video/webm" }));
        preview.style.display = "none";
        recorded.style.display = "block";
        player.send("host.stop");
        status.value = "Video recorded";
      };
      recorder.start();
      player.send("host.record");
      status.value = "Recording";
      started = performance.now();
      const tick = () => {
        const seconds = Math.floor((performance.now() - started) / 1000);
        recording.value = `REC ${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
      };
      tick();
      timer = setInterval(tick, 1000);
    });
    root.querySelector(".retake")?.addEventListener("click", () => {
      showPreview();
      player.send("host.retake");
      status.value = "Camera ready";
    });
    root.querySelector(".use")?.addEventListener("click", () => (status.value = mode === "photo" ? "Photo selected" : "Video selected"));
    return {
      dispose() {
        alive = false;
        clearInterval(timer);
        recorder?.state === "recording" && recorder.stop();
        media.stop();
      },
    };
  },
  // WAI-ARIA slider: aria-valuenow follows the value, frame by frame.
  slider: (player, root) => ({
    onFrame: (values) => root.querySelector("[role=slider]")?.setAttribute("aria-valuenow", String(Math.round(values["thumb.x"] / 2))),
  }),
};

const STAGE_STYLE = `
  :host { display: grid; place-items: center; padding: 12px; box-sizing: border-box; }
  :host > * { max-width: 100%; }
  .generic { display: flex; gap: 16px; align-items: center; justify-content: center; flex-wrap: wrap; padding: 16px; }
  .target { display: grid; place-items: center; width: 64px; height: 64px; border-radius: 12px; background: #cbd5e1; color: #1e293b;
    font: 11px ui-monospace, "SF Mono", Menlo, monospace; cursor: pointer; user-select: none; -webkit-tap-highlight-color: transparent; }
`;

/**
 * Plays a program on a stage. `content` is { style, markup }; when the markup lacks
 * some target, every target gets a labeled box instead.
 */
function mount(stage, program, content, { hook, onState, onEvent, speed } = {}) {
  const root = stage.shadowRoot ?? stage.attachShadow({ mode: "open" });
  const names = new Set([...new DOMParser().parseFromString(`<div>${content.markup}</div>`, "text/html").querySelectorAll("[data-nudg]")].map((el) => el.dataset.nudg));
  const covered = program.targets.every((t) => names.has(t));
  root.innerHTML = `<style>${STAGE_STYLE}${covered ? content.style : ""}</style>${covered ? content.markup : `<div class="generic">${program.targets.map((t) => `<div class="target" data-nudg="${t}">${t}</div>`).join("")}</div>`}`;

  const start = () => {
    let late;
    let alive = true;
    const timers = new Set();
    // setTimeout in player time: scaled by speed, cleared when this player goes.
    const after = (ms, fn) => {
      const id = setTimeout(() => {
        timers.delete(id);
        if (alive) fn();
      }, ms / (speed ?? 1));
      timers.add(id);
      return () => {
        clearTimeout(id);
        timers.delete(id);
      };
    };
    const player = play(program, root, {
      onState: (state) => {
        onState?.(state);
        late?.onState?.(state);
      },
      onFrame: (values) => late?.onFrame?.(values),
      onEvent,
      speed,
    });
    // App events the hook sends count as interaction too, so compare mode can mirror them;
    // a hook that outlives its player (a timer) sends nothing.
    const forHook = { ...player, send: (event) => { if (!alive) return false; onEvent?.({ event }, player.now()); return player.send(event); } };
    const extra = hook?.(forHook, root, { after });
    if (extra) late = extra;
    // WAI-ARIA switch pattern: the app keeps aria-checked in step with the state.
    const switches = root.querySelectorAll("[role=switch]");
    if (switches.length) {
      const sync = (state) => switches.forEach((s) => s.setAttribute("aria-checked", String(state.includes("on"))));
      const previous = late;
      late = { onState: (state) => { previous?.onState?.(state); sync(state); } };
      sync(player.runtime.state());
    }
    onState?.(player.runtime.state());
    const stop = () => {
      alive = false;
      late?.dispose?.();
      for (const id of timers) clearTimeout(id);
      timers.clear();
      player.destroy();
    };
    return { player, stop };
  };
  let current = start();
  return {
    get player() {
      return current.player;
    },
    /** Back to the initial state, with fresh markup: the host page's own reset. */
    reset() {
      current.stop();
      root.innerHTML = root.innerHTML;
      current = start();
    },
    destroy: () => current.stop(),
  };
}

const live = new Map();
function unmountAll() {
  for (const handle of live.values()) handle.destroy();
  live.clear();
}

// --- helpers ---------------------------------------------------------------------

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? "" : v);
  }
  node.append(...children);
  return node;
}

/** Copies text, falling back to a selection-based copy where the clipboard API is unavailable (e.g. plain http on a LAN address). */
async function copyText(button, text) {
  const label = button.textContent;
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    const area = document.body.appendChild(el("textarea", { style: "position:fixed;opacity:0", "aria-hidden": "true" }, text));
    area.select();
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
  }
  button.textContent = ok ? "Copied" : "Copy failed (select the text and copy)";
  setTimeout(() => (button.textContent = label), ok ? 1500 : 3500);
}

function tagLink(tag) {
  return el("a", { class: "tag", href: `#tag=${encodeURIComponent(tag)}` }, tag);
}

function reactSnippet(ex, program) {
  const name = ex.title.replace(/[^A-Za-z0-9]+/g, "") || "Component";
  const refs = program.targets.map((t) => `      <div ref={bind("${t}")} />`).join("\n");
  const host = program.targets.length ? "" : "";
  return `import { useNudg } from "@nudg/core/react";
import doc from "./${ex.id}.nudg.json";

export function ${name}() {
  const { bind, state, send } = useNudg(doc);
  // Attach each target to one of your own elements; nudg writes their styles.
  return (
    <div data-state={state.join(" ")}>
${refs}
    </div>
  );
}${host}
`;
}

function componentName(ex) {
  return ex.title.replace(/[^A-Za-z0-9]+/g, "") || "Component";
}

function reactNativeSnippet(ex, program) {
  const name = componentName(ex);
  const bindings = program.targets.map((target, i) => `  const target${i} = bind(${JSON.stringify(target)});`).join("\n");
  const views = program.targets
    .map((_, i) => `      <Animated.View {...target${i}.gesture} onLayout={target${i}.onLayout} style={target${i}.style} />`)
    .join("\n");
  return `import { Animated, View } from "react-native";
import { useNudg } from "@nudg/core/native";
import doc from "./${ex.id}.nudg.json";

export function ${name}() {
  const { bind, state } = useNudg(doc);
${bindings}
  return (
    <View accessibilityLabel={state.join(" ")}>
${views}
    </View>
  );
}
`;
}

function swiftSnippet(ex, program) {
  const name = componentName(ex);
  const target = program.targets[0] ?? "target";
  return `import Nudg
import NudgSwiftUI
import SwiftUI

struct ${name}Motion: View {
  @StateObject private var motion: NudgModel

  init() {
    let url = Bundle.main.url(forResource: "${ex.id}", withExtension: "program.json")!
    let program = try! Program.decode(Data(contentsOf: url))
    _motion = StateObject(wrappedValue: NudgModel(program))
  }

  var body: some View {
    RoundedRectangle(cornerRadius: 8)
      .nudgLayout(motion, "${target}")
      .nudg(motion, "${target}")
      .nudgPress(motion, "${target}")
      .nudgKeys(motion, "${target}")
  }
}
`;
}

function composeSnippet(ex, program) {
  const name = componentName(ex);
  const target = program.targets[0] ?? "target";
  return `import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import dev.nudg.Program
import dev.nudg.compose.nudg
import dev.nudg.compose.nudgKeys
import dev.nudg.compose.nudgLayout
import dev.nudg.compose.nudgPress
import dev.nudg.compose.rememberNudg

@Composable
fun ${name}Motion() {
    val context = LocalContext.current
    val program = remember {
        Program.decode(context.assets.open("${ex.id}.program.json").bufferedReader().use { it.readText() })
    }
    val motion = rememberNudg(program)

    Box(
        Modifier
            .nudgLayout(motion, "${target}")
            .nudg(motion, "${target}")
            .nudgPress(motion, "${target}")
            .nudgKeys(motion, "${target}")
    )
}
`;
}

// --- views -----------------------------------------------------------------------

const views = {
  browse: document.getElementById("view-browse"),
  detail: document.getElementById("view-detail"),
  playground: document.getElementById("view-playground"),
};

function show(name) {
  for (const [key, section] of Object.entries(views)) section.hidden = key !== name;
  document.getElementById("nav-playground").setAttribute("aria-current", name === "playground" ? "true" : "false");
  window.scrollTo(0, 0);
}

// Browse: category nav, tag chips, search, grid.
const grid = document.getElementById("grid");
const search = document.getElementById("search");
const nav = document.getElementById("categories");

function renderNav(current) {
  const count = (id) => examples.filter((e) => !id || e.category === id).length;
  nav.replaceChildren(
    el("a", { href: "#", "aria-current": !current ? "true" : "false" }, "All examples", el("span", {}, String(count()))),
    ...catalog.categories.map((c) =>
      el("a", { href: `#category=${c.id}`, "aria-current": current === c.id ? "true" : "false" }, c.title, el("span", {}, String(count(c.id)))),
    ),
  );
}

function renderTags(current) {
  const counts = new Map();
  for (const e of examples) for (const t of e.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  const tags = document.getElementById("tags");
  tags.replaceChildren(
    ...[...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t, n]) =>
      el("a", { class: "tag", href: current === t ? "#" : `#tag=${encodeURIComponent(t)}`, "aria-pressed": current === t ? "true" : "false" }, `${t} ${n}`),
    ),
  );
}

async function renderBrowse({ category, tag, q }) {
  show("browse");
  unmountAll();
  renderNav(category);
  renderTags(tag);
  const title = category ? catalog.categories.find((c) => c.id === category)?.title : tag ? `Tagged ${tag}` : "All examples";
  document.getElementById("browse-title").textContent = title ?? "All examples";
  const needle = (q ?? "").trim().toLowerCase();
  const shown = examples.filter(
    (e) =>
      (!category || e.category === category) &&
      (!tag || e.tags.includes(tag)) &&
      (!needle || [e.id, e.title, e.summary, ...e.tags].join(" ").toLowerCase().includes(needle)),
  );
  document.getElementById("empty").hidden = shown.length > 0;
  grid.replaceChildren(
    ...shown.map((ex) => {
      const state = el("span", { class: "state" });
      const stage = el("div", { class: "stage" });
      const reset = el("button", { type: "button", class: "reset", title: "Back to the initial state", onclick: () => live.get(ex.id)?.reset() }, "Reset");
      const card = el(
        "article",
        { class: "card" },
        stage,
        el("div", { class: "meta" }, el("h3", {}, el("a", { href: `#example/${ex.id}` }, ex.title)), state, reset),
        el("p", {}, ex.summary),
      );
      Promise.all([load(ex), page(ex.html)]).then(([{ program, diagnostics }, content]) => {
        if (!program) {
          state.textContent = `${diagnostics.length} problems`;
          return;
        }
        if (grid.contains(card)) live.set(ex.id, mount(stage, program, content, { hook: HOOKS[ex.id], onState: (s) => (state.textContent = s.join("  ")) }));
      });
      return card;
    }),
  );
}

// Detail: a large stage, the catalog entry, prompts, and the source under tabs.
let detailTab = "nudg";
async function renderDetail(id) {
  const ex = byId.get(id);
  if (!ex) return renderBrowse({});
  show("detail");
  unmountAll();
  renderNav(ex.category);
  document.title = `${ex.title} · nudg examples`;
  document.getElementById("detail-title").textContent = ex.title;
  document.getElementById("detail-summary").textContent = ex.summary;
  document.getElementById("detail-tags").replaceChildren(...ex.tags.map(tagLink));
  document.getElementById("detail-hint").textContent = ex.tags.includes("host-event") ? "Some transitions are sent by the app; this page wires its controls to them." : "";
  const prompts = document.getElementById("detail-prompts");
  prompts.replaceChildren(
    ...ex.prompts.map((p) => {
      const button = el("button", { type: "button", onclick: (e) => copyText(e.currentTarget, p) }, "Copy");
      return el("li", {}, el("span", {}, p), button);
    }),
  );

  const [{ program, diagnostics, source }, content] = await Promise.all([load(ex), page(ex.html)]);
  if (location.hash !== `#example/${id}`) return;
  const stateLabel = document.getElementById("detail-state");
  if (program) live.set(ex.id, mount(document.getElementById("detail-stage"), program, content, { hook: HOOKS[ex.id], onState: (s) => (stateLabel.textContent = s.join("  ")) }));
  else stateLabel.textContent = `${diagnostics.length} problems`;

  const code = document.getElementById("detail-code");
  const tabs = {
    nudg: source,
    html: `<style>\n${content.style.trim()}\n</style>\n\n${content.markup}`,
    react: program ? reactSnippet(ex, program) : "",
    "react-native": program ? reactNativeSnippet(ex, program) : "",
    swiftui: program ? swiftSnippet(ex, program) : "",
    compose: program ? composeSnippet(ex, program) : "",
  };
  const tablist = document.getElementById("detail-tabs");
  const select = (name) => {
    detailTab = name;
    for (const b of tablist.querySelectorAll("[role=tab]")) b.setAttribute("aria-selected", b.dataset.tab === name ? "true" : "false");
    code.textContent = tabs[name];
  };
  tablist.onclick = (e) => e.target.dataset?.tab && select(e.target.dataset.tab);
  select(detailTab);
  document.getElementById("detail-copy").onclick = (e) => copyText(e.currentTarget, source);
  document.getElementById("detail-reset").onclick = () => live.get(ex.id)?.reset();
  document.getElementById("detail-open").onclick = () => {
    playgroundSeed = ex.id;
    playgroundLoaded = null;
    setCompare(false);
    location.hash = "#playground";
  };
  document.getElementById("detail-compare").onclick = () => {
    playgroundSeed = ex.id;
    playgroundLoaded = null;
    setCompare(true);
    location.hash = "#playground";
  };
}

// Playground: any file, recompiled on every edit.
const pgStage = document.getElementById("playground-stage");
const pgSource = document.getElementById("playground-source");
const pgList = document.getElementById("playground-diagnostics");
const pgPicker = document.getElementById("playground-example");
const pgState = document.getElementById("playground-state");
for (const ex of examples) pgPicker.append(new Option(`${ex.id}.nudg.json`, ex.id));
pgPicker.addEventListener("change", () => seedPlayground(pgPicker.value));
document.getElementById("playground-copy").addEventListener("click", (e) => copyText(e.currentTarget, pgSource.value));
document.getElementById("playground-reset").addEventListener("click", () => {
  live.get("playground")?.reset();
  live.get("playground-a")?.reset();
  clearSession();
  showVerdict();
});
let playgroundSeed = "toggle";

// Compare mode: the original plays beside the edit; interacting with either sends the
// same events to both, and the verdict (core `compare`, in the browser) says whether a
// person would notice the difference.
const pgCompare = document.getElementById("playground-compare");
const pgSpeed = document.getElementById("playground-speed");
const pgVerdict = document.getElementById("playground-verdict");
let compareOn = false;
let speed = 1;
/** The interaction so far, as events on one timeline, for the verdict. */
const session = [];
let verdictTimer = 0;
// Players restart their clocks at every remount (an edit, a speed change); the session
// keeps one timeline by offsetting each mount after the last recorded moment.
let sessionBase = 0;
let sessionLast = 0;
function newTimeline() {
  sessionBase = session.length ? sessionLast + 0.5 : 0;
}
function clearSession() {
  session.length = 0;
  sessionBase = 0;
  sessionLast = 0;
}

function setCompare(on) {
  compareOn = on;
  pgCompare.setAttribute("aria-pressed", String(on));
  document.getElementById("playground").classList.toggle("compare", on);
  document.getElementById("playground-a").hidden = !on;
  document.getElementById("playground-label-b").hidden = !on;
  document.getElementById("playground-speed-label").hidden = !on;
  pgVerdict.hidden = !on;
  clearSession();
  showVerdict();
}
pgCompare.addEventListener("click", () => {
  setCompare(!compareOn);
  updatePlayground();
});
pgSpeed.addEventListener("change", () => {
  speed = Number(pgSpeed.value);
  updatePlayground();
});

/** Records one stage's interaction and forwards it to the other, without echo. */
function mirror(other) {
  return (item, t) => {
    const target = live.get(other)?.player;
    if (target) {
      if ("event" in item) target.send(item.event);
      else target.input(item.input, item.value);
    }
    const at = sessionBase + t;
    sessionLast = Math.max(sessionLast, at);
    session.push({ ...item, t: at });
    clearTimeout(verdictTimer);
    verdictTimer = setTimeout(showVerdict, 400);
  };
}

let compared = { a: null, b: null };
function showVerdict() {
  if (!compareOn) return;
  pgVerdict.removeAttribute("data-verdict");
  if (!compared.a || !compared.b) {
    pgVerdict.textContent = "Fix the file to compare.";
    return;
  }
  if (session.length === 0) {
    pgVerdict.textContent = "Interact with either stage; both get it. Then the verdict appears here: would a person notice the difference?";
    return;
  }
  // The last 10 s of interaction, so a long session stays cheap to simulate.
  const recent = session.filter((e) => e.t >= sessionLast - 10);
  const t0 = recent[0].t;
  const events = recent.map((e) => ({ ...e, t: Math.max(0, e.t - t0) + 0.05 }));
  try {
    const result = compare(compared.a, compared.b, { events, until: events.at(-1).t + 4 });
    pgVerdict.textContent = result.headline + (result.suggestion ? ` ${result.suggestion}` : "");
    pgVerdict.dataset.verdict = result.verdict;
  } catch (e) {
    pgVerdict.textContent = `Couldn't compare: ${e.message}`;
  }
}
let playgroundContent = { style: "", markup: "" };
let playgroundLoaded = null;
let pgPending = 0;

async function seedPlayground(id) {
  const ex = byId.get(id);
  if (!ex) return;
  const [{ source }, content] = await Promise.all([load(ex), page(ex.html)]);
  playgroundContent = content;
  if (playgroundLoaded !== id) clearSession();
  playgroundLoaded = id;
  pgSource.value = source;
  pgPicker.value = id;
  updatePlayground();
}

async function renderPlayground() {
  show("playground");
  unmountAll();
  renderNav(undefined);
  document.title = "Playground · nudg examples";
  if (playgroundLoaded !== playgroundSeed || !pgSource.value) await seedPlayground(playgroundSeed);
  else updatePlayground();
}

async function updatePlayground() {
  const text = pgSource.value;
  const { program, diagnostics } = await compileText(text, "../examples/playground.nudg.json");
  if (text !== pgSource.value || views.playground.hidden) return;
  pgList.replaceChildren(
    ...(diagnostics.length
      ? diagnostics.map((d) =>
          el("li", { class: d.severity }, `${d.severity} ${d.code} at ${d.path || "/"}: ${d.message}`, ...(d.hint ? [el("span", { class: "hint" }, `hint: ${d.hint}`)] : [])),
        )
      : [el("li", { class: "ok" }, "No problems. Interact with the stage.")]),
  );
  live.get("playground")?.destroy();
  live.get("playground-a")?.destroy();
  live.delete("playground-a");
  newTimeline();
  compared = { a: null, b: program ?? null };
  if (!program) {
    showVerdict();
    return;
  }
  if (compareOn) {
    const original = byId.get(playgroundLoaded) ? (await load(byId.get(playgroundLoaded))).program : null;
    compared.a = original;
    if (original) {
      const stateA = document.getElementById("playground-state-a");
      live.set("playground-a", mount(document.getElementById("playground-stage-a"), original, playgroundContent, { hook: HOOKS[playgroundLoaded], onState: (s) => (stateA.textContent = s.join("  ")), onEvent: mirror("playground"), speed }));
    }
  }
  live.set("playground", mount(pgStage, program, playgroundContent, { hook: HOOKS[playgroundLoaded], onState: (s) => (pgState.textContent = s.join("  ")), onEvent: compareOn ? mirror("playground-a") : undefined, speed: compareOn ? speed : 1 }));
  showVerdict();
}

pgSource.addEventListener("input", () => {
  clearTimeout(pgPending);
  pgPending = setTimeout(updatePlayground, 150);
});

// --- routing ---------------------------------------------------------------------

function route() {
  const hash = location.hash.replace(/^#/, "");
  if (hash === "playground") return renderPlayground();
  if (hash.startsWith("example/")) return renderDetail(decodeURIComponent(hash.slice("example/".length)));
  const params = new URLSearchParams(hash);
  document.title = "nudg examples";
  const q = params.get("q") ?? search.value;
  return renderBrowse({ category: params.get("category") ?? undefined, tag: params.get("tag") ?? undefined, q });
}

search.addEventListener("input", () => {
  if (views.browse.hidden) location.hash = "#";
  else route();
});
window.addEventListener("hashchange", route);
route();
window.__nudgStarted = true;
