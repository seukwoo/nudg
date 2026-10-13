// Demo wiring. Run `npm run demo` and open http://localhost:8787/demo/
//
// Deterministic frames: ?at=0.25&send=toggle:track.tap@0.1 renders every card with a
// manual clock at 0.25 s, after sending the listed events (card:event@seconds).

import { compile } from "../dist/index.js";
import { compileUrl, play } from "../dist/dom/index.js";

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

for (const card of document.querySelectorAll("[data-example]")) {
  const name = card.dataset.example;
  const url = `../examples/${name}.nudg.json`;
  const [{ program, diagnostics }, source] = await Promise.all([compileUrl(url), fetch(url).then((r) => r.text())]);
  card.querySelector("pre code").textContent = source;
  if (program) start(name, program, card);
  else card.querySelector(".state").textContent = `${diagnostics.length} problems`;
}

// Playground: recompile on every edit and replay.
const card = document.querySelector(".playground");
const textarea = document.getElementById("playground-source");
const list = document.getElementById("playground-diagnostics");
textarea.value = await fetch("../examples/toggle.nudg.json").then((r) => r.text());

let current;
let pending = 0;

function update() {
  const { program, diagnostics } = compile({ path: "/demo/playground.nudg.json", text: textarea.value });
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
      : [Object.assign(document.createElement("li"), { className: "ok", textContent: "No problems. Tap the toggle." })]),
  );
  if (!program) return;
  current?.stop();
  current = start("playground", program, card);
}

textarea.addEventListener("input", () => {
  clearTimeout(pending);
  pending = setTimeout(update, 150);
});
update();
