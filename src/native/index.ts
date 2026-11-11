// React Native adapter. The same nudg files, the same core: values go to Animated
// values that the views' styles read, so React doesn't re-render while things move.
//
//   const { bind, send, state } = useNudg(toggle);
//   <Pressable {...bind("track").press}><Animated.View {...bind("knob")} /></Pressable>

export { useNudg, pieceStyle } from "./use-nudg.ts";
export type { Bound, NudgNative, UseNudgNativeOptions } from "./use-nudg.ts";
export { compose } from "./compose.ts";
export { expoHaptics } from "./haptics.ts";
export type { ExpoHapticsModule, HapticPlayer } from "./haptics.ts";
export type { FiredCue, Piece } from "../core/runtime.ts";
export { NudgCompare } from "./compare.ts";
export type { NudgCompareProps } from "./compare.ts";
export { presets, press, hover, toggle, toast, appear, pop, drop, shake } from "../core/presets.ts";
export type { NudgContract, StateName } from "../core/types.ts";
