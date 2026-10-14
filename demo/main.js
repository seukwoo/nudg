// Demo wiring. Run `npm run demo` and open http://localhost:8787/demo/
//
// Deterministic frames: ?at=0.25&send=toggle:track.tap@0.1 renders every card with a
// manual clock at 0.25 s, after sending the listed events (card:event@seconds).

import { compileText, compileUrl, play } from "../dist/dom/index.js";

const params = new URLSearchParams(location.search);
const frameAt = params.has("at") ? Number(params.get("at")) : undefined;
const sends = params.getAll("send");

function start(name, program, card) {
  const stage = card.querySelector(".stage");
  const label = card.querySelector(".state");
  const player = play(program, stage, { clock: frameAt === undefined ? "realtime" : "manual" });
  const showState = () => (label.textContent = player.runtime.state().join("  "));

  if (frameAt !== undefined) {
    const events = sends
      .filter((s) => s.startsWith(`${name}:`))
      .map((s) => {
        const [event, t] = s.slice(name.length + 1).split("@");
        return { event, t: Number(t) };
      })
      .sort((a, b) => a.t - b.t);
    for (const { event, t } of events) {
      player.render(t);
      player.send(event);
    }
    player.render(frameAt);
  }

  showState();
  // Releases can land outside the stage (a cancel), so listen on the window.
  const onInput = () => requestAnimationFrame(showState);
  const types = ["pointerdown", "pointerup", "pointercancel", "click"];
  for (const type of types) window.addEventListener(type, onInput);
  return {
    player,
    stop() {
      player.destroy();
      for (const type of types) window.removeEventListener(type, onInput);
    },
  };
}

const EXAMPLES = ["toggle", "toggle-press", "like", "toggle-drag", "swipe-row"];
const sources = new Map();

async function copyText(button, text) {
  try {
    await navigator.clipboard.writeText(text);
    const label = button.textContent;
    button.textContent = "Copied";
    setTimeout(() => (button.textContent = label), 1500);
  } catch {
    button.textContent = "Copy failed";
  }
}

for (const card of document.querySelectorAll("[data-example]")) {
  const name = card.dataset.example;
  const url = `../examples/${name}.nudg.json`;
  const [{ program, diagnostics }, source] = await Promise.all([compileUrl(url), fetch(url).then((r) => r.text())]);
  sources.set(name, source);
  card.querySelector("pre code").textContent = source;
  card.querySelector("[data-copy]").addEventListener("click", (e) => copyText(e.currentTarget, source));
  card.querySelector("[data-open]").addEventListener("click", () => openInPlayground(name));
  if (program) start(name, program, card);
  else card.querySelector(".state").textContent = `${diagnostics.length} problems`;
}

// Playground: recompile on every edit and replay. Any file works: targets that have no
// markup in the stage get a labeled box each.
const card = document.querySelector(".playground");
const stage = document.getElementById("playground-stage");
const textarea = document.getElementById("playground-source");
const list = document.getElementById("playground-diagnostics");
const picker = document.getElementById("playground-example");
for (const name of EXAMPLES) picker.append(new Option(`${name}.nudg.json`, name));
picker.addEventListener("change", () => openInPlayground(picker.value));
document.getElementById("playground-copy").addEventListener("click", (e) => copyText(e.currentTarget, textarea.value));

let current;
let pending = 0;
/** The markup the stage currently shows, so a file whose targets it covers keeps it. */
let stageMarkup = stage.innerHTML;

function openInPlayground(name) {
  const example = document.querySelector(`[data-example="${name}"] .stage`);
  stageMarkup = example ? example.innerHTML : "";
  textarea.value = sources.get(name) ?? "";
  picker.value = name;
  update();
  card.scrollIntoView({ behavior: "smooth", block: "start" });
}

function setStage(program) {
  const names = new Set([...new DOMParser().parseFromString(`<div>${stageMarkup}</div>`, "text/html").querySelectorAll("[data-nudg]")].map((el) => el.dataset.nudg));
  if (program.targets.every((t) => names.has(t))) {
    stage.innerHTML = stageMarkup;
    return;
  }
  const generic = document.createElement("div");
  generic.className = "generic";
  for (const t of program.targets) {
    const box = document.createElement("div");
    box.className = "target";
    box.dataset.nudg = t;
    box.textContent = t;
    generic.append(box);
  }
  stage.replaceChildren(generic);
}

async function update() {
  const text = textarea.value;
  const { program, diagnostics } = await compileText(text, "../examples/playground.nudg.json");
  if (text !== textarea.value) return; // superseded by a newer edit
  list.replaceChildren(
    ...(diagnostics.length
      ? diagnostics.map((d) => {
          const li = document.createElement("li");
          li.className = d.severity;
          li.textContent = `${d.severity} ${d.code} at ${d.path || "/"}: ${d.message}`;
          if (d.hint) {
            const hint = document.createElement("span");
            hint.className = "hint";
            hint.textContent = `hint: ${d.hint}`;
            li.append(hint);
          }
          return li;
        })
      : [Object.assign(document.createElement("li"), { className: "ok", textContent: "No problems. Interact with the stage." })]),
  );
  if (!program) return;
  current?.stop();
  setStage(program);
  current = start("playground", program, card);
}

textarea.addEventListener("input", () => {
  clearTimeout(pending);
  pending = setTimeout(update, 150);
});
openInPlayground("toggle");
