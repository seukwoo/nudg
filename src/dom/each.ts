// One file on every element that matches a selector: the same press on every button in an
// app, a hover on every card. Players are made as they're needed and let go when their
// element leaves the page, so the host keeps no list.
//
//   playEach(presets.press(), "button, .card");                      // bound when a finger lands
//   playEach(presets.appear(), "[data-tip]", { when: "mount", start: "host.show" });

import { toProgram } from "../core/to-program.ts";
import type { NudgContract, Program } from "../core/types.ts";
import { play, type Player, type PlayOptions } from "./play.ts";

export interface PlayEachOptions<C extends NudgContract = NudgContract> extends Omit<PlayOptions<C>, "bind"> {
  /** Where to look, default the document. */
  root?: Document | Element;
  /**
   * "press" (default): an element gets its player when a pointer lands on it or it takes
   * focus, in the capture phase, so the press shows on that very touch. "mount": every
   * matching element gets one as it appears.
   */
  when?: "press" | "mount";
  /** Files the documents import, as in playDoc. */
  files?: Record<string, unknown>;
}

export interface PlayEach {
  /** The player bound to `element`, if it has one. */
  get(element: Element): Player | undefined;
  /** Destroys every player and stops looking for elements. */
  stop(): void;
}

/**
 * Plays `file` on every element under `root` that matches `selector`, each bound to the
 * file's first target. `file` may be a function of the element, to pick a variant (a wide
 * button presses less). Disabled controls and anything inside `[data-nudg-off]` are skipped.
 */
export function playEach<C extends NudgContract = NudgContract>(file: object | ((element: Element) => object), selector: string, options: PlayEachOptions<C> = {}): PlayEach {
  const { root = document, when = "press", files, ...rest } = options;
  const players = new Map<Element, Player>();
  // Compiled once per document object, so a function returning one of a few variants stays cheap.
  const compiled = new WeakMap<object, Program>();
  const programFor = (el: Element) => {
    const doc = typeof file === "function" ? file(el) : file;
    let program = compiled.get(doc);
    if (!program) compiled.set(doc, (program = toProgram(doc, files)));
    return program;
  };

  const skipped = (el: Element) =>
    (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true" || el.closest("[data-nudg-off]") !== null;

  const ensure = (el: Element) => {
    if (players.has(el) || skipped(el)) return;
    const program = programFor(el);
    players.set(el, play(program, null, { ...(rest as PlayOptions), bind: { [program.targets[0]]: el } }));
  };

  // Players whose elements left the page.
  const sweep = () => {
    for (const [el, p] of players) {
      if (el.isConnected) continue;
      p.destroy();
      players.delete(el);
    }
  };

  const onLand = (e: Event) => {
    if (e.type === "pointerdown" && (e as PointerEvent).pointerType === "mouse" && (e as PointerEvent).button !== 0) return;
    const el = e.target instanceof Element ? e.target.closest(selector) : null;
    if (!el || !root.contains(el)) return;
    sweep();
    ensure(el);
  };

  let observer: MutationObserver | undefined;
  if (when === "press") {
    root.addEventListener("pointerdown", onLand, { capture: true, passive: true });
    root.addEventListener("focusin", onLand, { capture: true });
  } else {
    const scan = () => {
      sweep();
      if (root instanceof Element && root.matches(selector)) ensure(root);
      for (const el of root.querySelectorAll(selector)) ensure(el);
    };
    scan();
    observer = new MutationObserver(scan);
    observer.observe(root, { childList: true, subtree: true });
  }

  return {
    get: (element) => players.get(element),
    stop() {
      root.removeEventListener("pointerdown", onLand, { capture: true });
      root.removeEventListener("focusin", onLand, { capture: true });
      observer?.disconnect();
      for (const p of players.values()) p.destroy();
      players.clear();
    },
  };
}
