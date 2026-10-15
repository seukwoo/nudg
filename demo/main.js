// The examples site. Run `npm run demo` and open http://localhost:8787/demo/
//
// Everything comes from ../examples/index.json: each example's nudg file is compiled
// and played on its host page's markup, which lives in a shadow root so the pages'
// styles can't collide with each other or with this site.

import { compileText, compileUrl, play } from "../dist/dom/index.js";
import { compare } from "../dist/index.js";

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
  toast(player, root) {
    let timer;
    root.querySelector(".toast-show")?.addEventListener("click", () => {
      player.send("host.show");
      clearTimeout(timer);
      timer = setTimeout(() => player.send("host.hide"), 2500);
    });
  },
  "pull-to-refresh": (player) => ({
    onState: (state) => state.includes("refreshing") && setTimeout(() => player.send("host.done"), 1500),
  }),
  // WAI-ARIA dialog: focus moves into the dialog when it opens and back to the opener when it closes.
  dialog: (player, root) => ({
    onState: (state) => root.querySelector(state.includes("open") ? ".close" : ".opener")?.focus({ preventScroll: true }),
  }),
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
    const player = play(program, root, {
      onState: (state) => {
        onState?.(state);
        late?.onState?.(state);
      },
      onFrame: (values) => late?.onFrame?.(values),
      onEvent,
      speed,
    });
    // App events the hook sends count as interaction too, so compare mode can mirror them.
    const forHook = onEvent ? { ...player, send: (event) => { onEvent({ event }, player.now()); return player.send(event); } } : player;
    const extra = hook?.(forHook, root);
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
    return player;
  };
  let player = start();
  return {
    get player() {
      return player;
    },
    /** Back to the initial state, with fresh markup: the host page's own reset. */
    reset() {
      player.destroy();
      root.innerHTML = root.innerHTML;
      player = start();
    },
    destroy: () => player.destroy(),
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
  const tabs = { nudg: source, html: `<style>\n${content.style.trim()}\n</style>\n\n${content.markup}`, react: program ? reactSnippet(ex, program) : "" };
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
    setCompare(false);
    location.hash = "#playground";
  };
  document.getElementById("detail-compare").onclick = () => {
    playgroundSeed = ex.id;
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
  session.length = 0;
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
/** The interaction so far, as events on a shared clock, for the verdict. */
const session = [];
let verdictTimer = 0;

function setCompare(on) {
  compareOn = on;
  pgCompare.setAttribute("aria-pressed", String(on));
  document.getElementById("playground").classList.toggle("compare", on);
  document.getElementById("playground-a").hidden = !on;
  document.getElementById("playground-label-b").hidden = !on;
  document.getElementById("playground-speed-label").hidden = !on;
  pgVerdict.hidden = !on;
  session.length = 0;
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
    session.push({ ...item, t });
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
  const t0 = session[0].t;
  const events = session.map((e) => ({ ...e, t: Math.max(0, e.t - t0) + 0.05 }));
  try {
    const result = compare(compared.a, compared.b, { events, until: Math.min(10, events.at(-1).t + 4) });
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
