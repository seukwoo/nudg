// React Native adapter. The same nudg files, the same core: values go to Animated
// values that the views' styles read, so React doesn't re-render while things move.
//
//   const { bind, send, state } = useNudg(toggle);
//   <Pressable {...bind("track").press}><Animated.View {...bind("knob")} /></Pressable>

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, type LayoutChangeEvent } from "react-native";
import { createPlayer, toProgram, type HeadlessPlayer } from "../core/player.ts";
import { createRuntime, type Value } from "../core/runtime.ts";
import type { Program } from "../core/types.ts";

export { presets, press, hover, toggle, toast } from "../core/presets.ts";

export interface UseNudgNativeOptions {
  state?: string[];
  files?: Record<string, unknown>;
  /** Default: the system's Reduce Motion setting. */
  reducedMotion?: boolean;
  exit?: string | string[];
  onExit?: () => void;
}

/** What `bind(name)` gives a view: its animated style, layout reporting, and press handlers. */
export interface Bound {
  style: Record<string, unknown>;
  onLayout: (e: LayoutChangeEvent) => void;
  /** Spread on a Pressable: down, up, cancel and tap become this target's events. */
  press: { onPressIn: () => void; onPressOut: () => void; onPress: () => void };
}

export interface NudgNative {
  bind(name: string): Bound;
  send(event: string): boolean;
  state: string[];
  present: boolean;
}

const TRANSFORM = ["x", "y", "rotation", "scale", "scaleX", "scaleY"] as const;

export function useNudg(source: Program | object, options: UseNudgNativeOptions = {}): NudgNative {
  const key = "machine" in source ? source : JSON.stringify(source);
  const program = useMemo(() => toProgram(source, options.files), [key]);
  // One Animated value per property; views read them, the player writes them.
  const animated = useMemo(() => {
    const out = new Map<string, Animated.Value | Animated.Color>();
    const initial = createRuntime(program, { state: options.state }).sample(0);
    for (const [k, prop] of program.properties) out.set(k, prop.kind === "color" ? new Animated.Color(initial[k] as string) : new Animated.Value(initial[k] as number));
    return out;
  }, [program]);
  const [state, setState] = useState<string[]>(() => createRuntime(program, { state: options.state }).state());
  const [present, setPresent] = useState(true);
  const player = useRef<HeadlessPlayer | null>(null);
  const onExit = useRef(options.onExit);
  onExit.current = options.onExit;
  const [reduced, setReduced] = useState<boolean | undefined>(options.reducedMotion);

  useEffect(() => {
    if (options.reducedMotion !== undefined) return;
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled().then((on) => live && setReduced(on)).catch(() => {});
    return () => void (live = false);
  }, [options.reducedMotion]);

  useEffect(() => {
    const p = createPlayer(program, {
      host: { now: () => performance.now() / 1000, frame: (fn) => { const id = requestAnimationFrame(fn); return () => cancelAnimationFrame(id); } },
      state: options.state,
      reducedMotion: reduced,
      exit: options.exit,
      onExit: () => {
        setPresent(false);
        onExit.current?.();
      },
      onState: (s) => {
        setState(s);
        if (p.present()) setPresent(true);
      },
      onFrame: (values) => write(animated, values),
    });
    player.current = p;
    return () => {
      p.destroy();
      player.current = null;
    };
  }, [program, animated, reduced]);

  const styles = useMemo(() => {
    const out = new Map<string, Record<string, unknown>>();
    for (const target of program.targets) out.set(target, styleFor(program, target, animated));
    return out;
  }, [program, animated]);

  const bound = useRef(new Map<string, Bound>());
  const bind = useCallback(
    (name: string): Bound => {
      let b = bound.current.get(name);
      if (!b) {
        const send = (event: string) => player.current?.send(`${name}.${event}`);
        b = {
          style: styles.get(name) ?? {},
          onLayout: (e) => {
            const { x, y, width, height } = e.nativeEvent.layout;
            for (const [m, v] of [["x", x], ["y", y], ["width", width], ["height", height]] as const) player.current?.input(`${name}.layout.${m}`, v);
          },
          press: { onPressIn: () => send("down"), onPressOut: () => send("up"), onPress: () => send("tap") },
        };
        bound.current.set(name, b);
      }
      return b;
    },
    [styles],
  );
  const send = useCallback((event: string) => player.current?.send(event) ?? false, []);
  return { bind, send, state, present };
}

function write(animated: Map<string, Animated.Value | Animated.Color>, values: Record<string, Value>) {
  for (const [k, v] of Object.entries(values)) {
    const a = animated.get(k);
    if (a instanceof Animated.Color) a.setValue(v as string);
    else (a as Animated.Value | undefined)?.setValue(v as number);
  }
}

/** A target's style, reading the Animated values: transform in nudg's order (translate, rotate, scale). */
function styleFor(program: Program, target: string, animated: Map<string, Animated.Value | Animated.Color>): Record<string, unknown> {
  const style: Record<string, unknown> = {};
  const get = (p: string) => animated.get(`${target}.${p}`);
  const transform: Record<string, unknown>[] = [];
  for (const p of TRANSFORM) {
    const a = get(p);
    if (!a) continue;
    if (p === "x") transform.push({ translateX: a });
    else if (p === "y") transform.push({ translateY: a });
    else if (p === "rotation") transform.push({ rotate: (a as Animated.Value).interpolate({ inputRange: [0, 360], outputRange: ["0deg", "360deg"], extrapolate: "extend" }) });
    else transform.push({ [p]: a });
  }
  if (transform.length) style.transform = transform;
  for (const p of ["opacity", "width", "height"]) if (get(p)) style[p] = get(p);
  if (get("color")) style.backgroundColor = get("color");
  void program;
  return style;
}
