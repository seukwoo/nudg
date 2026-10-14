// DOM adapter: binds targets to elements, turns pointer, hover and focus input into
// nudg events and inputs, and applies sampled values to styles. All motion math stays
// in the core.

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
}

export interface Player {
  readonly runtime: Runtime;
  /** Targets the file uses that have no element. */
  readonly unbound: string[];
  /** [data-nudg] names under the root that the file doesn't declare. */
  readonly unknown: string[];
  /** Sends an event now, as if it came from input (e.g. "host.check"). */
  send(event: string): boolean;
  /** Records an input sample now (e.g. "track.drag.x", 12). */
  input(name: string, value: number): boolean;
  /** Binds one more element to a target. Returns a function that unbinds it. */
  bind(name: string, element: Element): () => void;
  /** Manual clock: applies the values at time `t` (seconds). */
  render(t: number): void;
  destroy(): void;
}

const TRANSFORM_PROPS = new Set(["x", "y", "rotation", "scale", "scaleX", "scaleY"]);
/** Logical units the pointer must travel before a press becomes a drag. */
const DRAG_SLOP = 4;

export function play(program: Program, root: ParentNode | null = document, options: PlayOptions = {}): Player {
  const elements = new Map<string, Set<Element>>();
  const cleanups = new Map<Element, () => void>();
  const found = new Set<string>();
  const runtime = createRuntime(program, { state: options.state });
  const manual = options.clock === "manual";
  const start = performance.now();
  const draggable = dragTargets(program);
  let manualTime = 0;
  let frame = 0;
  let lastState = runtime.state().join("\n");
  const now = () => (manual ? manualTime : (performance.now() - start) / 1000);

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

  function apply(values: Record<string, Value>) {
    for (const [target, els] of elements) applyTo(target, values, els);
  }

  function tick() {
    frame = 0;
    const t = now();
    apply(runtime.sample(t));
    if (!runtime.settled(t)) frame = requestAnimationFrame(tick);
  }

  function changed() {
    if (manual) apply(runtime.sample(manualTime));
    else if (!frame) frame = requestAnimationFrame(tick);
    const state = runtime.state();
    if (state.join("\n") !== lastState) {
      lastState = state.join("\n");
      options.onState?.(state);
    }
  }

  function send(event: string): boolean {
    const handled = runtime.send(event, now());
    changed();
    return handled;
  }

  function input(name: string, value: number): boolean {
    const used = runtime.input(name, value, now());
    changed();
    return used;
  }

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
          send(`${name}.down`);
        },
      ],
      [
        "click",
        () => {
          if (suppressTap.delete(name)) return;
          send(`${name}.tap`);
        },
      ],
      ["pointerenter", (e) => (e as PointerEvent).pointerType !== "touch" && send(`${name}.hoverstart`)],
      ["pointerleave", (e) => (e as PointerEvent).pointerType !== "touch" && send(`${name}.hoverend`)],
      ["focus", () => send(`${name}.focus`)],
      ["blur", () => send(`${name}.blur`)],
    ];
    for (const [type, fn] of listeners) el.addEventListener(type, fn);
    const style = (el as HTMLElement).style;
    const touchAction = style?.touchAction;
    // Let a drag reach us instead of scrolling the page.
    if (draggable.has(name) && style) style.touchAction = "none";
    applyTo(name, runtime.sample(now()), [el]);

    const unbind = () => {
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
        send(`${name}.dragstart`);
      }
      runtime.input(`${name}.drag.x`, p.clientX - press.x, now());
      runtime.input(`${name}.drag.y`, p.clientY - press.y, now());
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
      send(`${name}.${!cancelled && inside ? "up" : "cancel"}`);
      if (press.dragging) send(`${name}.dragend`);
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
    render(t) {
      if (!manual) throw new Error("render(t) needs { clock: \"manual\" }.");
      manualTime = t;
      apply(runtime.sample(t));
    },
    destroy() {
      cancelAnimationFrame(frame);
      for (const unbind of [...cleanups.values()]) unbind();
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onCancel, true);
    },
  };
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
