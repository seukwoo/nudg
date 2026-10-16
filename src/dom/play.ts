// DOM adapter: binds targets to elements, turns pointer, hover and focus input into
// nudg events and inputs, and applies sampled values to styles. All motion math stays
// in the core.

import { compile } from "../core/compile.ts";
import { createRuntime, type Runtime, type Value } from "../core/runtime.ts";
import type { Machine, Program } from "../core/types.ts";

export interface PlayOptions {
  /** Elements to bind by target name, in addition to [data-nudg] attributes. */
  bind?: Record<string, Element | Element[]>;
  /**
   * "realtime" (default) follows the wall clock. "manual" only moves when you call
   * render(t), and events are stamped with the last rendered time: use it for
   * deterministic frames and tests.
   */
  clock?: "realtime" | "manual";
  /** Leaf state paths to start in instead of `initial`, e.g. ["on"]. */
  state?: string[];
  /** Called with the active states after any event changes them. */
  onState?: (state: string[]) => void;
  /** Reduced motion (v0.3). Default: the system's prefers-reduced-motion setting. */
  reducedMotion?: boolean;
  /** Called with the values after every frame they're applied, e.g. to keep aria-valuenow in step. */
  onFrame?: (values: Record<string, Value>) => void;
  /**
   * States that mean the component is gone, e.g. "hidden". Once the machine has entered
   * one from elsewhere and every value has come to rest, `present()` turns false and
   * `onExit` is called: that is when to remove the element, not before, or the exit
   * motion never shows. Leaving the state again makes it present again.
   */
  exit?: string | string[];
  /** Called once each time the component has fully exited (see `exit`). */
  onExit?: () => void;
  /**
   * Called for every event and input sample the adapter itself produces from the DOM
   * (not for `send` and `input` calls), with the player's time: to mirror one player's
   * interaction onto another, or to record a session for `nudg simulate`.
   */
  onEvent?: (item: { event: string } | { input: string; value: number }, t: number) => void;
  /** Time scale for the real-time clock: 0.25 plays everything, timers included, at quarter speed. Default 1. */
  speed?: number;
}

export interface Player {
  readonly runtime: Runtime;
  /** Targets the file uses that have no element. */
  readonly unbound: string[];
  /** [data-nudg] names under the root that the file doesn't declare. */
  readonly unknown: string[];
  /** Sends an event now, as if it came from input (e.g. "host.check"). False once destroyed. */
  send(event: string): boolean;
  /** The values last applied to the elements. */
  values(): Record<string, Value>;
  /** Records an input sample now (e.g. "track.drag.x", 12). */
  input(name: string, value: number): boolean;
  /** Binds one more element to a target. Returns a function that unbinds it. */
  bind(name: string, element: Element): () => void;
  /** The player's current time in seconds: scaled real time, or the last rendered time on a manual clock. */
  now(): number;
  /** Manual clock: applies the values at time `t` (seconds). */
  render(t: number): void;
  /** False once the machine has exited (see `exit` in the options) and settled. */
  present(): boolean;
  destroy(): void;
}

const TRANSFORM_PROPS = new Set(["x", "y", "rotation", "scale", "scaleX", "scaleY"]);

/**
 * Compiles a document (a preset, or a parsed .nudg.json) and plays it, in one call:
 * `playDoc(presets.press(), button)`. When `root` is an element with no [data-nudg]
 * inside, it is bound to the document's first target. Throws if the document has errors.
 */
export function playDoc(doc: object, root: ParentNode | null = document, options: PlayOptions & { files?: Record<string, unknown> } = {}): Player {
  const files = new Map(Object.entries(options.files ?? {}).map(([k, v]) => [k.replace(/^(\.\/)+/, ""), v]));
  const { program, diagnostics } = compile({ path: "main.nudg.json", text: JSON.stringify(doc) }, (path) =>
    files.has(path) ? JSON.stringify(files.get(path)) : undefined,
  );
  if (!program) {
    const lines = diagnostics.filter((d) => d.severity === "error").map((d) => `${d.code} at ${d.path}: ${d.message}${d.hint ? ` (${d.hint})` : ""}`);
    throw new Error(`nudg: the document has errors:\n${lines.join("\n")}`);
  }
  const bare = root instanceof Element && !root.querySelector("[data-nudg]") && !root.hasAttribute("data-nudg");
  const { files: _files, ...rest } = options;
  return play(program, bare ? null : root, bare ? { ...rest, bind: { [program.targets[0]]: root, ...rest.bind } } : rest);
}
/** Logical units the pointer must travel before a press becomes a drag. */
const DRAG_SLOP = 4;

export function play(program: Program, root: ParentNode | null = document, options: PlayOptions = {}): Player {
  const elements = new Map<string, Set<Element>>();
  const cleanups = new Map<Element, () => void>();
  const found = new Set<string>();
  const reducedMotion = options.reducedMotion ?? (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const runtime = createRuntime(program, { state: options.state, reducedMotion });
  const keyEvents = keyEventsOf(program);
  const manual = options.clock === "manual";
  const start = performance.now();
  const draggable = dragTargets(program);
  const speed = options.speed ?? 1;
  if (!(speed > 0)) throw new RangeError("`speed` must be greater than 0.");
  let manualTime = 0;
  let frame = 0;
  let lastState = runtime.state().join("\n");
  const now = () => (manual ? manualTime : ((performance.now() - start) / 1000) * speed);

  // Which properties each target has, so we only write the styles the file owns.
  const byTarget = new Map<string, string[]>();
  for (const key of program.properties.keys()) {
    const [target, prop] = key.split(".");
    byTarget.set(target, [...(byTarget.get(target) ?? []), prop]);
  }

  function applyTo(target: string, values: Record<string, Value>, els: Iterable<Element>) {
    const props = byTarget.get(target);
    if (!props) return;
    const v = (prop: string, fallback: number) => (props.includes(prop) ? (values[`${target}.${prop}`] as number) : fallback);
    const transform = props.some((p) => TRANSFORM_PROPS.has(p))
      ? `translate(${v("x", 0)}px, ${v("y", 0)}px) rotate(${v("rotation", 0)}deg) scale(${v("scale", 1) * v("scaleX", 1)}, ${v("scale", 1) * v("scaleY", 1)})`
      : undefined;
    for (const el of els) {
      const style = (el as HTMLElement | SVGElement).style;
      if (transform !== undefined) style.transform = transform;
      if (props.includes("opacity")) style.opacity = String(v("opacity", 1));
      if (props.includes("width")) style.width = `${v("width", 0)}px`;
      if (props.includes("height")) style.height = `${v("height", 0)}px`;
      if (props.includes("color")) {
        const color = values[`${target}.color`] as string;
        if (el instanceof SVGElement) style.fill = color;
        else style.backgroundColor = color;
      }
    }
  }

  // Presence: the host keeps the element until the exit motion has played.
  const exits = new Set(typeof options.exit === "string" ? [options.exit] : (options.exit ?? []));
  const inExit = () => runtime.state().some((path) => exits.has(path) || exits.has(path.split("/").pop()!));
  let present = true;
  // Only an exit entered from somewhere else counts; mounting in "hidden" hasn't exited anything.
  let armed = exits.size > 0 && !inExit();
  function syncPresence(t: number) {
    if (exits.size === 0) return;
    if (!inExit()) {
      armed = true;
      present = true;
      return;
    }
    if (armed && present && runtime.settled(t)) {
      present = false;
      armed = false;
      options.onExit?.();
    }
  }

  let lastValues: Record<string, Value> = {};
  function apply(values: Record<string, Value>) {
    lastValues = values;
    for (const [target, els] of elements) applyTo(target, values, els);
    options.onFrame?.(values);
  }

  function tick() {
    frame = 0;
    const t = now();
    apply(runtime.sample(t));
    syncState(); // timers may have fired while time advanced
    if (!runtime.settled(t)) frame = requestAnimationFrame(tick);
    else syncPresence(t);
  }

  // The active states, on every bound element, so CSS can style by state:
  // [data-nudg-state~="refreshing"] { animation: spin 1s linear infinite }
  function reflectState(els: Iterable<Element>) {
    const value = runtime.state().join(" ");
    for (const e of els) e.setAttribute("data-nudg-state", value);
  }

  function syncState() {
    const state = runtime.state();
    if (state.join("\n") !== lastState) {
      lastState = state.join("\n");
      for (const els of elements.values()) reflectState(els);
      options.onState?.(state);
    }
  }

  function changed() {
    if (manual) apply(runtime.sample(manualTime));
    else if (!frame) frame = requestAnimationFrame(tick);
    syncState();
    // An exit with nothing left to move is complete at once; otherwise the ticks finish it.
    syncPresence(now());
  }

  let destroyed = false;
  function send(event: string, fromDom = false): boolean {
    if (destroyed) return false;
    const t = now();
    const handled = runtime.send(event, t);
    if (fromDom) options.onEvent?.({ event }, t);
    changed();
    return handled;
  }

  function input(name: string, value: number): boolean {
    if (destroyed) return false;
    const used = runtime.input(name, value, now());
    changed();
    return used;
  }

  /** An event the DOM produced, as opposed to one the host sent. */
  const emit = (event: string) => send(event, true);

  // Pointer input. A press released outside its element is a cancel, not an up. A
  // press that travels past the slop becomes a drag; a drag never ends in a tap.
  interface Press {
    pointer: number;
    x: number;
    y: number;
    dragging: boolean;
  }
  const pressed = new Map<string, Press>();
  const suppressTap = new Set<string>();

  /** Set once layout reporting starts: elements bound later (React refs) are measured too. */
  let onLayoutBind: ((name: string, el: Element) => void) | undefined;

  function bind(name: string, el: Element): () => void {
    if (!program.targets.includes(name)) return () => {};
    const set = elements.get(name) ?? new Set<Element>();
    set.add(el);
    elements.set(name, set);
    const listeners: [string, (e: Event) => void][] = [
      [
        "pointerdown",
        (e) => {
          const p = e as PointerEvent;
          pressed.set(name, { pointer: p.pointerId, x: p.clientX, y: p.clientY, dragging: false });
          emit(`${name}.down`);
        },
      ],
      [
        "click",
        () => {
          if (suppressTap.delete(name)) return;
          emit(`${name}.tap`);
        },
      ],
      ["pointerenter", (e) => (e as PointerEvent).pointerType !== "touch" && emit(`${name}.hoverstart`)],
      ["pointerleave", (e) => (e as PointerEvent).pointerType !== "touch" && emit(`${name}.hoverend`)],
      ["focus", () => emit(`${name}.focus`)],
      ["blur", () => emit(`${name}.blur`)],
      [
        "keydown",
        (e) => {
          // Only keys the file listens for, so the page keeps its own behavior for the rest.
          const event = `${name}.key.${keyName((e as KeyboardEvent).key)}`;
          if (!keyEvents.has(event)) return;
          if (emit(event)) e.preventDefault();
        },
      ],
    ];
    for (const [type, fn] of listeners) el.addEventListener(type, fn);
    // Mark the element with its name, so a snapshot of the page (and observe's default
    // selector) can find targets bound by ref as well as by attribute.
    const marked = !el.hasAttribute("data-nudg");
    if (marked) el.setAttribute("data-nudg", name);
    const style = (el as HTMLElement).style;
    const touchAction = style?.touchAction;
    // Let a drag reach us instead of scrolling the page.
    if (draggable.has(name) && style) style.touchAction = "none";
    applyTo(name, runtime.sample(now()), [el]);
    reflectState([el]);
    onLayoutBind?.(name, el);

    const unbind = () => {
      el.removeAttribute("data-nudg-state");
      if (marked) el.removeAttribute("data-nudg");
      for (const [type, fn] of listeners) el.removeEventListener(type, fn);
      if (draggable.has(name) && style) style.touchAction = touchAction;
      elements.get(name)?.delete(el);
      if (elements.get(name)?.size === 0) elements.delete(name);
      cleanups.delete(el);
    };
    cleanups.set(el, unbind);
    return unbind;
  }

  const onMove = (e: Event) => {
    const p = e as PointerEvent;
    for (const [name, press] of pressed) {
      if (press.pointer !== p.pointerId || !draggable.has(name)) continue;
      if (!press.dragging) {
        if (Math.hypot(p.clientX - press.x, p.clientY - press.y) <= DRAG_SLOP) continue;
        // Inputs measure travel since the press, so the first sample catches the value
        // up with the pointer instead of leaving it behind by the slop.
        press.dragging = true;
        emit(`${name}.dragstart`);
      }
      const t = now();
      runtime.input(`${name}.drag.x`, p.clientX - press.x, t);
      runtime.input(`${name}.drag.y`, p.clientY - press.y, t);
      options.onEvent?.({ input: `${name}.drag.x`, value: p.clientX - press.x }, t);
      options.onEvent?.({ input: `${name}.drag.y`, value: p.clientY - press.y }, t);
      changed();
    }
  };

  const onRelease = (e: Event, cancelled: boolean) => {
    const p = e as PointerEvent;
    // One pointer can press nested targets at once; if it dragged any of them, none taps.
    const dragged = [...pressed.values()].some((press) => press.pointer === p.pointerId && press.dragging);
    for (const [name, press] of pressed) {
      if (press.pointer !== p.pointerId) continue;
      pressed.delete(name);
      // composedPath sees into shadow roots, where e.target is retargeted to the host.
      const released = (e.composedPath?.()[0] ?? e.target) as Node;
      const inside = [...(elements.get(name) ?? [])].some((el) => el.contains(released));
      emit(`${name}.${!cancelled && inside ? "up" : "cancel"}`);
      if (press.dragging) emit(`${name}.dragend`);
      if (dragged) {
        // The browser may still fire a click for this press; it isn't a tap.
        suppressTap.add(name);
        setTimeout(() => suppressTap.delete(name), 0);
      }
    }
  };
  const onUp = (e: Event) => onRelease(e, false);
  const onCancel = (e: Event) => onRelease(e, true);
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("pointercancel", onCancel, true);

  root?.querySelectorAll("[data-nudg]").forEach((el) => {
    const name = el.getAttribute("data-nudg")!;
    found.add(name);
    bind(name, el);
  });
  for (const [name, bound] of Object.entries(options.bind ?? {})) {
    for (const el of Array.isArray(bound) ? bound : [bound]) bind(name, el);
  }
  const unknown = [...found].filter((n) => !program.targets.includes(n));
  if (root) {
    const missing = program.targets.filter((t) => !elements.has(t));
    if (missing.length) console.warn(`nudg: no element bound for ${missing.join(", ")}. Add data-nudg="${missing[0]}" or pass it in options.bind.`);
    if (unknown.length) console.warn(`nudg: data-nudg="${unknown.join('", "')}" is not a target in this file.`);
  }

  // Layout (v0.4): report what the file measures, now and whenever it changes. Positions
  // are untransformed (offsets), so nudg's own motion is never part of what it measures.
  const needed = runtime.measurements();
  let observer: ResizeObserver | undefined;
  let measureFrame = 0;
  const measureNow = () => {
    measureFrame = 0;
    if (destroyed) return;
    let changedAny = false;
    for (const name of needed) {
      const [target, , what] = name.split(".");
      const el = elements.get(target)?.values().next().value;
      if (!el) continue;
      const v = measureElement(el, what);
      if (v !== undefined && runtime.input(name, v, now())) changedAny = true;
    }
    if (changedAny) changed();
  };
  const remeasure = () => {
    if (!measureFrame) measureFrame = requestAnimationFrame(measureNow);
  };
  if (needed.length) {
    measureNow();
    if (typeof ResizeObserver === "function") {
      observer = new ResizeObserver(remeasure);
      for (const name of needed) for (const el of elements.get(name.split(".")[0]) ?? []) observer.observe(el);
    }
    window.addEventListener("resize", remeasure);
    (document as Document & { fonts?: FontFaceSet }).fonts?.ready.then(remeasure).catch(() => {});
    const measuredTargets = new Set(needed.map((n) => n.split(".")[0]));
    onLayoutBind = (name, el) => {
      if (!measuredTargets.has(name)) return;
      observer?.observe(el);
      remeasure();
    };
  }

  // Real time has already started; sampling at 0 now would run the clock backwards.
  apply(runtime.sample(now()));

  return {
    runtime,
    get unbound() {
      return program.targets.filter((t) => !elements.has(t));
    },
    unknown,
    send,
    input,
    bind,
    values: () => lastValues,
    present() {
      return present;
    },
    now,
    render(t) {
      if (!manual) throw new Error("render(t) needs { clock: \"manual\" }.");
      manualTime = t;
      apply(runtime.sample(t));
      syncState();
      if (runtime.settled(t)) syncPresence(t);
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(measureFrame);
      observer?.disconnect();
      window.removeEventListener("resize", remeasure);
      for (const unbind of [...cleanups.values()]) unbind();
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onCancel, true);
    },
  };
}

/** KeyboardEvent.key as a nudg key name: " " is space, names are lowercased. */
function keyName(key: string): string {
  return key === " " ? "space" : key.toLowerCase();
}

/** Every target.key.<name> event the file handles. */
function keyEventsOf(program: Program): Set<string> {
  const out = new Set<string>();
  const addEvents = (keys: Iterable<string>) => {
    for (const key of keys) if (key.split(".")[1] === "key") out.add(key);
  };
  const walk = (machine: Machine) => {
    if (machine.kind === "regions") {
      for (const region of machine.regions.values()) walk(region);
      return;
    }
    addEvents(machine.when.keys());
    for (const state of machine.states.values()) {
      addEvents(state.when.keys());
      if (state.machine) walk(state.machine);
    }
  };
  walk(program.machine);
  return out;
}

/** Targets the file drags: used in drag events or as a followed drag input. */
function dragTargets(program: Program): Set<string> {
  const out = new Set<string>();
  const addEvents = (keys: Iterable<string>) => {
    for (const key of keys) {
      const [target, event] = key.split(".");
      if (event === "dragstart" || event === "dragend") out.add(target);
    }
  };
  const walk = (machine: Machine) => {
    if (machine.kind === "regions") {
      for (const region of machine.regions.values()) walk(region);
      return;
    }
    addEvents(machine.when.keys());
    for (const state of machine.states.values()) {
      addEvents(state.when.keys());
      for (const follow of state.follow.values()) out.add(follow.input.split(".")[0]);
      if (state.machine) walk(state.machine);
    }
  };
  walk(program.machine);
  return out;
}

/**
 * One layout measurement of an element, in CSS pixels (logical units): the untransformed
 * box from offsets, summed up to the page, or the natural size from the scroll size.
 */
function measureElement(el: Element, what: string): number | undefined {
  if (!(el instanceof HTMLElement)) {
    const r = el.getBoundingClientRect();
    return what === "x" ? r.left + scrollX : what === "y" ? r.top + scrollY : what === "width" || what === "naturalWidth" ? r.width : r.height;
  }
  switch (what) {
    case "x":
    case "y": {
      let sum = 0;
      for (let node: HTMLElement | null = el; node; node = node.offsetParent as HTMLElement | null) sum += what === "x" ? node.offsetLeft : node.offsetTop;
      return sum;
    }
    case "width":
      return el.offsetWidth;
    case "height":
      return el.offsetHeight;
    case "naturalWidth":
      return el.scrollWidth;
    case "naturalHeight":
      return el.scrollHeight;
  }
  return undefined;
}
