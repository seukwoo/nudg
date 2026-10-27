// React Native adapter. The same nudg files, the same core: values go to Animated
// values that the views' styles read, so React doesn't re-render while things move.
//
//   const { bind, send, state } = useNudg(toggle);
//   <Pressable {...bind("track").press}><Animated.View {...bind("knob")} /></Pressable>

export { useNudg } from "./use-nudg.ts";
export type { Bound, NudgNative, UseNudgNativeOptions } from "./use-nudg.ts";
export { NudgCompare } from "./compare.ts";
export type { NudgCompareProps } from "./compare.ts";
export { presets, press, hover, toggle, toast, appear } from "../core/presets.ts";
export type { NudgContract, StateName } from "../core/types.ts";
