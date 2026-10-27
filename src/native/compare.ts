// Two versions of a component side by side, on the app's own views: React Native's side
// of `nudg compare` (`nudg compare a b --bundle x.compare.json`). The same rules as SwiftUI's
// and Compose's NudgCompare: the headline first, before and the change, in a loop, what you
// do on one side happening on the other, Replay and ¼× / ⅒×.
//
//   <NudgCompare comparison={require("./toggle.compare.json")}>
//     {(nudg) => <Toggle nudg={nudg} />}
//   </NudgCompare>

import { createElement as h, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { compareTimeline, readCompareBundle, type ComparisonData } from "../core/compare-session.ts";
import type { TimedEvent } from "../core/simulate.ts";
import type { Program } from "../core/types.ts";
import { useNudgWith, type NudgNative } from "./use-nudg.ts";

export interface NudgCompareProps {
  /** The bundle `nudg compare --bundle` wrote (its parsed JSON). */
  comparison: object;
  /** Your view for one player; called once for each side. */
  children: (nudg: NudgNative) => ReactNode;
}

const SPEEDS: [number, string][] = [[1, "1×"], [0.25, "¼×"], [0.1, "⅒×"]];
const GRAY = "#6b7280";
const BLUE = "#2563eb";

export function NudgCompare({ comparison, children }: NudgCompareProps) {
  const data = useMemo(() => readCompareBundle(comparison), [comparison]);
  const timeline = useMemo(() => compareTimeline(data, () => performance.now() / 1000), [data]);
  const [run, setRun] = useState(0);
  const [speed, setSpeed] = useState(1);
  const sides = useRef<(NudgNative | undefined)[]>([]);
  const mirroring = useRef(false);
  const mirror = (fn: () => void) => {
    if (mirroring.current) return;
    mirroring.current = true;
    try {
      fn();
    } finally {
      mirroring.current = false;
    }
  };
  const deliver = (step: TimedEvent) =>
    mirror(() => {
      for (const side of sides.current) {
        if (!side) continue;
        if ("event" in step) side.send(step.event);
        else side.input(step.input, step.value);
      }
    });

  // The comparison's timeline, every frame: due steps to both sides, and a new run once both rested.
  useEffect(() => {
    let id = requestAnimationFrame(function frame() {
      const { steps, restarted } = timeline.due();
      steps.forEach(deliver);
      if (restarted) setRun((r) => r + 1);
      id = requestAnimationFrame(frame);
    });
    return () => cancelAnimationFrame(id);
  }, [timeline]);

  const side = (index: 0 | 1, program: Program, role: string) =>
    h(Side, {
      key: `${index}-${run}`,
      program,
      data,
      now: timeline.now,
      label: data.labels[index],
      role,
      register: (nudg: NudgNative) => (sides.current[index] = nudg),
      // What a person does on one side happens on the other; layout stays each side's own.
      onSend: (event: string) => mirror(() => sides.current[1 - index]?.send(event)),
      onInput: (name: string, value: number) => !name.includes(".layout.") && mirror(() => sides.current[1 - index]?.input(name, value)),
      render: children,
    });

  return h(
    View,
    { style: { padding: 16, gap: 14 } },
    h(Text, { style: { fontSize: 15 } }, data.headline),
    data.suggestion ? h(Text, { style: { fontSize: 13, color: GRAY } }, data.suggestion) : null,
    h(View, { style: { flexDirection: "row", gap: 16 } }, side(0, data.a, "before"), side(1, data.b, "the change")),
    h(
      View,
      { style: { flexDirection: "row", gap: 20 } },
      control("Replay", false, () => {
        timeline.restart();
        setRun((r) => r + 1);
      }),
      ...SPEEDS.map(([value, label]) =>
        control(label, speed === value, () => {
          timeline.speed = value;
          setSpeed(value);
        }),
      ),
    ),
  );
}

/** A plain text button: the adapter brings no design system of its own. */
function control(label: string, selected: boolean, onPress: () => void) {
  return h(
    Pressable,
    { key: label, onPress, accessibilityRole: "button", accessibilityState: { selected }, hitSlop: 8 },
    h(Text, { style: { fontSize: 15, color: BLUE, fontWeight: selected ? "700" : "400", paddingVertical: 8 } }, label),
  );
}

interface SideProps {
  program: Program;
  data: ComparisonData;
  now: () => number;
  label: string;
  role: string;
  register: (nudg: NudgNative) => void;
  onSend: (event: string) => void;
  onInput: (name: string, value: number) => void;
  render: (nudg: NudgNative) => ReactNode;
}

/** One version: its own player on the shared clock, rendered through the app's view. */
function Side({ program, data, now, label, role, register, onSend, onInput, render }: SideProps) {
  const nudg = useNudgWith(program, { state: data.start, reducedMotion: data.reducedMotion }, { now, onSend, onInput });
  register(nudg);
  return h(
    View,
    { style: { flex: 1, gap: 8 } },
    h(Text, { style: { fontSize: 12 } }, h(Text, { style: { fontWeight: "700" } }, label), h(Text, { style: { color: GRAY } }, ` · ${role}`)),
    render(nudg),
  );
}
