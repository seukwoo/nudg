// The React Native hook: values go to Animated values that the views' styles read, so
// React doesn't re-render while things move. `useNudgWith` is the same hook with what
// NudgCompare needs (a shared clock, mirroring); apps use `useNudg`.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, PanResponder, type GestureResponderEvent, type LayoutChangeEvent } from "react-native";
import { PointerTracker, draggableTargets, pinchableTargets } from "../core/pointer.ts";
import { activation, touchSync } from "./touches.ts";
import { handledEvents, unknownEventMessage } from "../core/observe.ts";
import { createPlayer, initialValues, toProgram, type HeadlessPlayer } from "../core/player.ts";
import { createRuntime, type Value } from "../core/runtime.ts";
import type { NudgContract, Program, StateName } from "../core/types.ts";

export interface UseNudgNativeOptions<C extends NudgContract = NudgContract> {
  state?: C["states"][];
  /** App inputs known before mount, e.g. { "host.progress": 0.6 }: the first frame uses them. Read once; update with `input`. */
  inputs?: Partial<Record<C["inputs"], number>>;
  files?: Record<string, unknown>;
  /** Default: the system's Reduce Motion setting. */
  reducedMotion?: boolean;
  exit?: StateName<C> | StateName<C>[];
  onExit?: () => void;
  /** Called with the active states each time every value has come to rest; as in the React hook. */
  onSettle?: (state: C["states"][]) => void;
}

/** What `bind(name)` gives a view: its animated style, layout reporting, and press handlers. */
export interface Bound {
  style: Record<string, unknown>;
  onLayout: (e: LayoutChangeEvent) => void;
  /** Spread on a Pressable: down, up, cancel and tap become this target's events. */
  press: { onPressIn: () => void; onPressOut: () => void; onPress: () => void };
  /**
   * Spread on any View for press and drag: down, up and tap like `press`, and for targets
   * the file drags, dragstart, drag.x / drag.y and dragend, with the same 4-unit slop as the web.
   * When the file handles the target's tap, screen readers can activate it: activation is a
   * tap, as a click is on the web (a Pressable with `press` already does this).
   */
  gesture: Record<string, unknown>;
}

export interface NudgNative<C extends NudgContract = NudgContract> {
  bind(name: C["targets"]): Bound;
  send(event: C["events"]): boolean;
  /** Supplies a continuous app value, as in the React hook: input("host.volume", 0.7). */
  input(name: C["inputs"], value: number): boolean;
  state: C["states"][];
  present: boolean;
}

const TRANSFORM = ["x", "y", "rotation", "scale", "scaleX", "scaleY"] as const;

export function useNudg<C extends NudgContract = NudgContract>(source: Program | object, options: UseNudgNativeOptions<C> = {}): NudgNative<C> {
  return useNudgWith(source, options);
}

/** What NudgCompare adds to a player: the shared clock, and everything sent to it, for the other side. */
export interface NudgInternals {
  now?: () => number;
  onSend?: (event: string) => void;
  onInput?: (name: string, value: number) => void;
}

export function useNudgWith<C extends NudgContract = NudgContract>(source: Program | object, options: UseNudgNativeOptions<C> = {}, internals: NudgInternals = {}): NudgNative<C> {
  const extra = useRef(internals);
  extra.current = internals;
  const key = "machine" in source ? source : JSON.stringify(source);
  const program = useMemo(() => toProgram(source, options.files), [key]);
  // The latest value per app input, replayed into each new player; starts from `inputs`.
  const inputs = useRef<Map<string, number>>(null as unknown as Map<string, number>);
  if (!inputs.current) inputs.current = new Map(Object.entries(options.inputs ?? {}) as [string, number][]);
  // One Animated value per property; views read them, the player writes them.
  const animated = useMemo(() => {
    const out = new Map<string, Animated.Value | Animated.Color>();
    const initial = initialValues(program, { state: options.state, inputs: Object.fromEntries(inputs.current) });
    for (const [k, prop] of program.properties) out.set(k, prop.kind === "color" ? new Animated.Color(initial[k] as string) : new Animated.Value(initial[k] as number));
    return out;
  }, [program]);
  const [state, setState] = useState<string[]>(() => createRuntime(program, { state: options.state }).state());
  const [present, setPresent] = useState(true);
  const player = useRef<HeadlessPlayer | null>(null);
  const handledByFile = useMemo(() => handledEvents(program), [program]);
  const warned = useRef(new Set<string>());
  // Everything sent to the player goes through these, so NudgCompare can mirror it.
  const emit = (event: string, fromHost = false) => {
    // A misspelled event from the app would otherwise do nothing, silently; say so once per name.
    const unknown = fromHost && !warned.current.has(event) ? unknownEventMessage(program, handledByFile, event) : undefined;
    if (unknown) {
      warned.current.add(event);
      console.warn(unknown);
    }
    const handled = player.current?.send(event) ?? false;
    extra.current.onSend?.(event);
    return handled;
  };
  const emitInput = (name: string, value: number) => {
    const used = player.current?.input(name, value) ?? false;
    extra.current.onInput?.(name, value);
    return used;
  };
  const onExit = useRef(options.onExit);
  onExit.current = options.onExit;
  const onSettle = useRef(options.onSettle);
  onSettle.current = options.onSettle;
  const reads = useMemo(() => new Set(createRuntime(program).requiredInputs()), [program]);
  const [reduced, setReduced] = useState<boolean | undefined>(options.reducedMotion);

  useEffect(() => {
    if (options.reducedMotion !== undefined) return;
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled().then((on) => live && setReduced(on)).catch(() => {});
    return () => void (live = false);
  }, [options.reducedMotion]);

  useEffect(() => {
    const p = createPlayer(program, {
      host: { now: () => extra.current.now?.() ?? performance.now() / 1000, frame: (fn) => { const id = requestAnimationFrame(fn); return () => cancelAnimationFrame(id); } },
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
      onSettle: (s) => onSettle.current?.(s),
    });
    player.current = p;
    for (const [name, value] of inputs.current) p.input(name, value);
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

  const draggable = useMemo(() => draggableTargets(program), [program]);
  const pinchable = useMemo(() => pinchableTargets(program), [program]);
  const handled = handledByFile;
  const gestureFor = (name: string) => {
    const tracker = new PointerTracker(
      name,
      draggable.has(name),
      { send: (e) => void emit(e), input: (n, v) => void emitInput(n, v) },
      pinchable.has(name),
    );
    // Every finger by its identifier, so a second one can pinch (format 0.18).
    const touches = touchSync(tracker);
    const sync = (e: GestureResponderEvent, release: boolean) => touches.sync(e.nativeEvent.touches ?? [], release);
    const handlers = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => !draggable.has(name) && !pinchable.has(name),
      onPanResponderGrant: (e) => sync(e, false),
      onPanResponderMove: (e) => sync(e, false),
      onPanResponderRelease: (e) => sync(e, true),
      onPanResponderTerminate: () => touches.cancel(),
    }).panHandlers;
    return { ...handlers, ...activation(handled, name, (e) => void emit(e)) };
  };
  const bound = useRef(new Map<string, Bound>());
  const bind = useCallback(
    (name: string): Bound => {
      let b = bound.current.get(name);
      if (!b) {
        const send = (event: string) => emit(`${name}.${event}`);
        b = {
          style: styles.get(name) ?? {},
          onLayout: (e) => {
            const { x, y, width, height } = e.nativeEvent.layout;
            for (const [m, v] of [["x", x], ["y", y], ["width", width], ["height", height]] as const) player.current?.input(`${name}.layout.${m}`, v);
          },
          press: { onPressIn: () => send("down"), onPressOut: () => send("up"), onPress: () => send("tap") },
          gesture: gestureFor(name),
        };
        bound.current.set(name, b);
      }
      return b;
    },
    [styles],
  );
  const send = useCallback((event: string) => emit(event, true), []);
  const input = useCallback((name: string, value: number) => {
    const used = player.current ? emitInput(name, value) : reads.has(name) && Number.isFinite(value);
    if (used) inputs.current.set(name, value);
    return used;
  }, [reads]);
  return { bind, send, input, state, present };
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
