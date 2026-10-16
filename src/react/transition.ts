// A nudg file as the transition of a component library's overlay: MUI's transition slot
// (`slots.transition`, formerly `TransitionComponent`) and any library on the react-transition-group contract (Ant
// Design, React Bootstrap). The library keeps the behavior, focus and accessibility;
// nudg does the motion, and the element stays mounted until the exit has settled.

import { cloneElement, forwardRef, isValidElement, useLayoutEffect, useRef, type ForwardRefExoticComponent, type ReactElement, type Ref, type RefAttributes } from "react";
import { appear } from "../core/presets.ts";
import type { Program } from "../core/types.ts";
import { useNudg } from "./index.ts";

export interface NudgTransitionOptions {
  /** The event that shows it, default "host.show". */
  show?: string;
  /** The event that hides it, default "host.hide". */
  hide?: string;
  /** The state (or states) that mean hidden, default "hidden". */
  hidden?: string | string[];
  /** Which target the child element is, default the file's first target. */
  target?: string;
  /** Files the document imports, as in useNudg. */
  files?: Record<string, unknown>;
  reducedMotion?: boolean;
}

/** The props a react-transition-group style transition receives. */
export interface TransitionProps {
  in?: boolean;
  appear?: boolean;
  children?: ReactElement;
  onEnter?: (node: Element | null, isAppearing: boolean) => void;
  onEntering?: (node: Element | null, isAppearing: boolean) => void;
  onEntered?: (node: Element | null, isAppearing: boolean) => void;
  onExit?: (node: Element | null) => void;
  onExiting?: (node: Element | null) => void;
  onExited?: (node: Element | null) => void;
  style?: Record<string, unknown>;
  timeout?: unknown;
  easing?: unknown;
  addEndListener?: unknown;
}

/**
 * A transition component that plays `source` (default: presets.appear()) on its child:
 *
 *   <Dialog TransitionComponent={dialogTransition} />   // const dialogTransition = nudgTransition(file)
 *
 * Create it once, outside render: a new component every render would remount the child.
 */
export function nudgTransition(source: Program | object = appear(), options: NudgTransitionOptions = {}): ForwardRefExoticComponent<TransitionProps & RefAttributes<Element>> {
  const show = options.show ?? "host.show";
  const hide = options.hide ?? "host.hide";
  const hidden = options.hidden ?? "hidden";
  const target = options.target ?? firstTarget(source);
  const component = forwardRef<Element, TransitionProps>(function NudgTransition(props, ref) {
    const { in: inProp = false, appear: appearProp = true, children, onEnter, onEntering, onEntered, onExit, onExiting, onExited, style } = props;
    const node = useRef<Element | null>(null);
    const exited = useRef(onExited);
    exited.current = onExited;
    const nudg = useNudg(source, { files: options.files, reducedMotion: options.reducedMotion, exit: hidden, onExit: () => exited.current?.(node.current) });
    const first = useRef(true);

    useLayoutEffect(() => {
      const el = node.current;
      const appearing = first.current && appearProp;
      const wasFirst = first.current;
      first.current = false;
      if (inProp) {
        onEnter?.(el, appearing);
        nudg.send(show);
        onEntering?.(el, appearing);
        // react-transition-group calls onEntered when done; libraries use it for callbacks only.
        const id = requestAnimationFrame(() => onEntered?.(el, appearing));
        return () => cancelAnimationFrame(id);
      }
      if (!wasFirst) {
        onExit?.(el);
        nudg.send(hide);
        onExiting?.(el);
      }
      return undefined;
    }, [inProp]);

    if (!isValidElement(children)) return null;
    const child = children as ReactElement<{ style?: Record<string, unknown>; ref?: Ref<Element> }>;
    const bindRef = nudg.bind(target);
    const childRef = child.props.ref ?? (child as unknown as { ref?: Ref<Element> }).ref;
    const setRef = (el: Element | null) => {
      node.current = el;
      bindRef(el);
      assign(ref, el);
      assign(childRef, el);
    };
    return cloneElement(child, {
      ref: setRef,
      style: { ...child.props.style, ...style, ...(!inProp && !nudg.present ? { visibility: "hidden" } : {}) },
    });
  });
  component.displayName = "NudgTransition";
  return component;
}

function firstTarget(source: Program | object): string {
  const targets = (source as { targets?: unknown }).targets;
  return Array.isArray(targets) && typeof targets[0] === "string" ? targets[0] : "content";
}

function assign(ref: Ref<Element> | undefined, value: Element | null) {
  if (typeof ref === "function") ref(value);
  else if (ref && typeof ref === "object") (ref as { current: Element | null }).current = value;
}

