// React adapter. The hook hands elements to the DOM adapter through refs; values are
// written to styles directly, so React doesn't re-render on every frame.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { compile } from "../core/compile.ts";
import { createRuntime } from "../core/runtime.ts";
import type { NudgContract, Program, StateName } from "../core/types.ts";
import { play, type Player } from "../dom/play.ts";
import { initialValues } from "../core/player.ts";
import { propertiesByTarget, styleOf, type NudgStyle } from "../dom/style.ts";

export { presets, press, hover, toggle, toast, appear } from "../core/presets.ts";
export { nudgTransition } from "./transition.ts";
export type { NudgTransitionOptions, TransitionProps } from "./transition.ts";
export type { NudgContract, StateName } from "../core/types.ts";

export interface UseNudgOptions<C extends NudgContract = NudgContract> {
  /** Leaf state paths to start in instead of `initial`, e.g. ["on"] for a toggle that mounts checked. */
  state?: C["states"][];
  /**
   * App inputs known before mount, e.g. { "host.progress": 0.6 }: used for `style(name)`
   * on the server and the first paint, then applied when the player starts. Read once;
   * update with `input`.
   */
  inputs?: Partial<Record<C["inputs"], number>>;
  /**
   * Files the document imports, when passing a JSON object: `{ "./motion/brand.nudg.json": brand }`,
   * keyed as the import is written (a leading "./" is optional).
   */
  files?: Record<string, unknown>;
  /** Reduced motion (v0.3). Default: the system's prefers-reduced-motion setting. */
  reducedMotion?: boolean;
  /**
   * States that mean the component is gone, e.g. "hidden". `present` turns false once the
   * machine has entered one and every value has come to rest, and `onExit` is called:
   * render null then, or remove the item from its list, and the exit motion gets to play.
   */
  exit?: StateName<C> | StateName<C>[];
  onExit?: () => void;
  /**
   * Called with the active states each time every value has come to rest after something
   * moved or the state changed (a dialog finished opening): see PlayOptions.onSettle.
   * Doesn't re-render; set state in it if the component needs to.
   */
  onSettle?: (state: C["states"][]) => void;
  /** Follow the state a component library shows on the bound elements (data-state, aria-*); see PlayOptions.watch. */
  watch?: boolean;
}

export interface Nudg<C extends NudgContract = NudgContract> {
  /** A ref callback for a target: `<span ref={bind("knob")} />`. Stable per name. */
  bind(name: C["targets"]): (element: Element | null) => void;
  /** The active states, e.g. ["on"]. Updates when an event changes them. */
  state: C["states"][];
  /** Sends an event now, e.g. send("host.check"). */
  send(event: C["events"]): boolean;
  /**
   * Supplies a continuous app value the file reads with `map` or `follow`, e.g.
   * input("host.volume", 0.7). False for names the file doesn't read. The latest value
   * carries over when the program changes, and one given before mount applies at mount.
   */
  input(name: C["inputs"], value: number): boolean;
  /** False once the component has exited (see `exit`); true again if it is shown again. */
  present: boolean;
  /**
   * The target's first-frame style, for server rendering and the first paint:
   * `<div ref={bind("toast")} style={style("toast")} />`. Stable per name; the adapter
   * writes the moving values itself, so React never re-renders for motion. Pass
   * `{ svg: true }` for an SVG element, whose color is a fill.
   */
  style(name: C["targets"], options?: { svg?: boolean }): NudgStyle;
}

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Plays a nudg file in a component. Pass a compiled Program, or the file's JSON object
 * (for example from `import toggle from "./toggle.nudg.json"`), which is compiled once.
 * With the contract `nudg generate` writes, names are checked: `useNudg<ToggleContract>(toggle)`.
 */
export function useNudg<C extends NudgContract = NudgContract>(source: Program | object, options: UseNudgOptions<C> = {}): Nudg<C> {
  // An inline document (a preset call) is a new object every render; compile by content, not identity.
  const key = isProgram(source) ? source : JSON.stringify(source);
  const program = useMemo(() => toProgram(source, options.files), [key]);
  const player = useRef<Player | null>(null);
  // Elements currently attached through refs, so a new player (new program) can rebind them.
  const attached = useRef(new Map<string, { element: Element; unbind?: () => void }>());
  const refs = useRef(new Map<string, (element: Element | null) => void>());
  // The first render knows the starting states without touching the DOM.
  const [state, setState] = useState<string[]>(() => createRuntime(program, { state: options.state }).state());
  const [present, setPresent] = useState(true);
  const onExit = useRef(options.onExit);
  onExit.current = options.onExit;
  const onSettle = useRef(options.onSettle);
  onSettle.current = options.onSettle;
  // The latest value per app input, replayed into each new player; starts from `inputs`.
  const inputs = useRef<Map<string, number>>(null as unknown as Map<string, number>);
  if (!inputs.current) inputs.current = new Map(Object.entries(options.inputs ?? {}) as [string, number][]);
  const reads = useMemo(() => new Set(createRuntime(program).requiredInputs()), [program]);

  useIsomorphicLayoutEffect(() => {
    const p = play(program, null, {
      state: options.state,
      reducedMotion: options.reducedMotion,
      onState: (s) => {
        setState(s);
        if (p.present()) setPresent(true);
      },
      exit: options.exit,
      watch: options.watch,
      onSettle: (s) => onSettle.current?.(s),
      onExit: () => {
        setPresent(false);
        onExit.current?.();
      },
    });
    player.current = p;
    for (const [name, value] of inputs.current) p.input(name, value);
    for (const [name, entry] of attached.current) entry.unbind = p.bind(name, entry.element);
    setState(p.runtime.state());
    return () => {
      p.destroy();
      player.current = null;
      for (const entry of attached.current.values()) entry.unbind = undefined;
    };
  }, [program]);

  const bind = useCallback((name: string) => {
    let ref = refs.current.get(name);
    if (!ref) {
      ref = (element: Element | null) => {
        const previous = attached.current.get(name);
        previous?.unbind?.();
        attached.current.delete(name);
        if (!element) return;
        attached.current.set(name, { element, unbind: player.current?.bind(name, element) });
      };
      refs.current.set(name, ref);
    }
    return ref;
  }, []);

  // The first frame as CSS, from the same state and inputs the player will start with.
  const first = useMemo(() => ({ values: initialValues(program, { state: options.state, inputs: Object.fromEntries(inputs.current) }), props: propertiesByTarget(program) }), [program]);
  const style = useCallback((name: string, opts: { svg?: boolean } = {}) => {
    const props = first.props.get(name);
    return props ? styleOf(name, props, first.values, opts.svg) : EMPTY_STYLE;
  }, [first]);

  const send = useCallback((event: string) => player.current?.send(event) ?? false, []);
  const input = useCallback((name: string, value: number) => {
    const p = player.current;
    const used = p ? p.input(name, value) : reads.has(name) && Number.isFinite(value);
    if (used) inputs.current.set(name, value);
    return used;
  }, [reads]);
  return { bind, state, send, input, present, style };
}

const EMPTY_STYLE: NudgStyle = {};

function isProgram(source: Program | object): source is Program {
  return "machine" in source && (source as Program).properties instanceof Map;
}

function toProgram(source: Program | object, files: Record<string, unknown> = {}): Program {
  if (isProgram(source)) return source;
  // The compiler asks for normalized paths ("motion/brand.nudg.json"); accept keys as people write imports.
  const byPath = new Map(Object.entries(files).map(([key, value]) => [key.replace(/^(\.\/)+/, ""), value]));
  const { program, diagnostics } = compile({ path: "main.nudg.json", text: JSON.stringify(source) }, (path) =>
    byPath.has(path) ? JSON.stringify(byPath.get(path)) : undefined,
  );
  if (!program) {
    const lines = diagnostics.filter((d) => d.severity === "error").map((d) => `${d.code} at ${d.path}: ${d.message}${d.hint ? ` (${d.hint})` : ""}`);
    throw new Error(`nudg: the file has errors:\n${lines.join("\n")}`);
  }
  return program;
}
