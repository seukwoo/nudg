// DOM adapter: binds targets to elements, turns pointer input into nudg events, and
// applies sampled values to styles. All motion math stays in the core.

import { createRuntime, type Runtime, type Value } from "../core/runtime.ts";
import type { Program } from "../core/types.ts";

export interface PlayOptions {
  /** Elements to bind by target name, in addition to [data-nudg] attributes. */
  bind?: Record<string, Element | Element[]>;
  /**
   * "realtime" (default) follows the wall clock. "manual" only moves when you call
   * render(t), and events are stamped with the last rendered time: use it for
   * deterministic frames and tests.
   */
  clock?: "realtime" | "manual";
}

export interface Player {
  readonly runtime: Runtime;
  /** Targets the file uses that have no element. */
  readonly unbound: string[];
  /** [data-nudg] names under the root that the file doesn't declare. */
  readonly unknown: string[];
  /** Sends an event now, as if it came from input. */
  send(event: string): boolean;
  /** Manual clock: applies the values at time `t` (seconds). */
  render(t: number): void;
  destroy(): void;
}

const TRANSFORM_PROPS = new Set(["x", "y", "rotation", "scale", "scaleX", "scaleY"]);

export function play(program: Program, root: ParentNode = document, options: PlayOptions = {}): Player {
  const elements = new Map<string, Element[]>();
  const found = new Set<string>();
  root.querySelectorAll("[data-nudg]").forEach((el) => {
    const name = el.getAttribute("data-nudg")!;
    found.add(name);
    if (program.targets.includes(name)) elements.set(name, [...(elements.get(name) ?? []), el]);
  });
  for (const [name, bound] of Object.entries(options.bind ?? {})) {
    elements.set(name, Array.isArray(bound) ? bound : [bound]);
  }
  const unbound = program.targets.filter((t) => !elements.has(t));
  const unknown = [...found].filter((n) => !program.targets.includes(n));
  if (unbound.length) console.warn(`nudg: no element bound for ${unbound.join(", ")}. Add data-nudg="${unbound[0]}" or pass it in options.bind.`);
  if (unknown.length) console.warn(`nudg: data-nudg="${unknown.join('", "')}" is not a target in this file.`);

  const runtime = createRuntime(program);
  const manual = options.clock === "manual";
  const start = performance.now();
  let manualTime = 0;
  let frame = 0;
  const now = () => (manual ? manualTime : (performance.now() - start) / 1000);

  // Which properties each target has, so we only write the styles the file owns.
  const byTarget = new Map<string, string[]>();
  for (const key of program.properties.keys()) {
    const [target, prop] = key.split(".");
    byTarget.set(target, [...(byTarget.get(target) ?? []), prop]);
  }

  function apply(values: Record<string, Value>) {
    for (const [target, props] of byTarget) {
      const v = (prop: string, fallback: number) => (props.includes(prop) ? (values[`${target}.${prop}`] as number) : fallback);
      const transform = props.some((p) => TRANSFORM_PROPS.has(p))
        ? `translate(${v("x", 0)}px, ${v("y", 0)}px) rotate(${v("rotation", 0)}deg) scale(${v("scale", 1) * v("scaleX", 1)}, ${v("scale", 1) * v("scaleY", 1)})`
        : undefined;
      for (const el of elements.get(target) ?? []) {
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
  }

  function tick() {
    frame = 0;
    const t = now();
    apply(runtime.sample(t));
    if (!runtime.settled(t)) frame = requestAnimationFrame(tick);
  }

  function send(event: string): boolean {
    const handled = runtime.send(event, now());
    if (manual) apply(runtime.sample(manualTime));
    else if (!frame) frame = requestAnimationFrame(tick);
    return handled;
  }

  // Pointer input. A press released outside its element is a cancel, not an up,
  // so a tap only happens when the pointer comes up where it went down.
  const cleanups: (() => void)[] = [];
  const listen = (target: EventTarget, type: string, fn: (e: Event) => void, capture = false) => {
    target.addEventListener(type, fn, capture);
    cleanups.push(() => target.removeEventListener(type, fn, capture));
  };
  const pressed = new Map<string, number>();
  for (const [name, els] of elements) {
    for (const el of els) {
      listen(el, "pointerdown", (e) => {
        pressed.set(name, (e as PointerEvent).pointerId);
        send(`${name}.down`);
      });
      listen(el, "click", () => send(`${name}.tap`));
    }
  }
  const release = (e: Event, cancelled: boolean) => {
    const id = (e as PointerEvent).pointerId;
    for (const [name, pointer] of pressed) {
      if (pointer !== id) continue;
      pressed.delete(name);
      const inside = (elements.get(name) ?? []).some((el) => el.contains(e.target as Node));
      send(`${name}.${!cancelled && inside ? "up" : "cancel"}`);
    }
  };
  listen(window, "pointerup", (e) => release(e, false), true);
  listen(window, "pointercancel", (e) => release(e, true), true);

  apply(runtime.sample(0));

  return {
    runtime,
    unbound,
    unknown,
    send,
    render(t) {
      if (!manual) throw new Error("render(t) needs { clock: \"manual\" }.");
      manualTime = t;
      apply(runtime.sample(t));
    },
    destroy() {
      cancelAnimationFrame(frame);
      for (const cleanup of cleanups) cleanup();
    },
  };
}
