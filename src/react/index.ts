// React adapter. The hook hands elements to the DOM adapter through refs; values are
// written to styles directly, so React doesn't re-render on every frame.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { compile } from "../core/compile.ts";
import { createRuntime } from "../core/runtime.ts";
import type { Program } from "../core/types.ts";
import { play, type Player } from "../dom/play.ts";

export interface UseNudgOptions {
  /** Leaf state paths to start in instead of `initial`, e.g. ["on"] for a toggle that mounts checked. */
  state?: string[];
  /**
   * Files the document imports, when passing a JSON object: `{ "./motion/brand.nudg.json": brand }`,
   * keyed as the import is written (a leading "./" is optional).
   */
  files?: Record<string, unknown>;
  /** Reduced motion (v0.3). Default: the system's prefers-reduced-motion setting. */
  reducedMotion?: boolean;
}

export interface Nudg {
  /** A ref callback for a target: `<span ref={bind("knob")} />`. Stable per name. */
  bind(name: string): (element: Element | null) => void;
  /** The active states, e.g. ["on"]. Updates when an event changes them. */
  state: string[];
  /** Sends an event now, e.g. send("host.check"). */
  send(event: string): boolean;
}

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Plays a nudg file in a component. Pass a compiled Program, or the file's JSON object
 * (for example from `import toggle from "./toggle.nudg.json"`), which is compiled once.
 */
export function useNudg(source: Program | object, options: UseNudgOptions = {}): Nudg {
  const program = useMemo(() => toProgram(source, options.files), [source]);
  const player = useRef<Player | null>(null);
  // Elements currently attached through refs, so a new player (new program) can rebind them.
  const attached = useRef(new Map<string, { element: Element; unbind?: () => void }>());
  const refs = useRef(new Map<string, (element: Element | null) => void>());
  // The first render knows the starting states without touching the DOM.
  const [state, setState] = useState<string[]>(() => createRuntime(program, { state: options.state }).state());

  useIsomorphicLayoutEffect(() => {
    const p = play(program, null, { state: options.state, reducedMotion: options.reducedMotion, onState: setState });
    player.current = p;
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

  const send = useCallback((event: string) => player.current?.send(event) ?? false, []);
  return { bind, state, send };
}

function toProgram(source: Program | object, files: Record<string, unknown> = {}): Program {
  if ("machine" in source && (source as Program).properties instanceof Map) return source as Program;
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
