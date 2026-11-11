// Haptics for React Native's cues (1.3). React Native has no haptics of its own, so the app
// passes a function; `expoHaptics` builds one from expo-haptics, which the app imports itself
// (nudg doesn't depend on it).
//
//   import * as Haptics from "expo-haptics";
//   useNudg(file, { haptics: expoHaptics(Haptics) });

/** Plays a nudg haptic intent (tick, light, success, ...) at an intensity from 0 to 1. */
export type HapticPlayer = (name: string, intensity: number) => void;

/** The parts of expo-haptics this uses. */
export interface ExpoHapticsModule {
  selectionAsync(): Promise<void>;
  impactAsync(style?: unknown): Promise<void>;
  notificationAsync(type?: unknown): Promise<void>;
  ImpactFeedbackStyle: { Light: unknown; Medium: unknown; Heavy: unknown; Soft?: unknown; Rigid?: unknown };
  NotificationFeedbackType: { Success: unknown; Warning: unknown; Error: unknown };
}

export function expoHaptics(h: ExpoHapticsModule): HapticPlayer {
  const impact = { light: h.ImpactFeedbackStyle.Light, medium: h.ImpactFeedbackStyle.Medium, heavy: h.ImpactFeedbackStyle.Heavy, soft: h.ImpactFeedbackStyle.Soft ?? h.ImpactFeedbackStyle.Light, rigid: h.ImpactFeedbackStyle.Rigid ?? h.ImpactFeedbackStyle.Medium } as Record<string, unknown>;
  const notify = { success: h.NotificationFeedbackType.Success, warning: h.NotificationFeedbackType.Warning, error: h.NotificationFeedbackType.Error } as Record<string, unknown>;
  return (name) => {
    const play = name in impact ? h.impactAsync(impact[name]) : name in notify ? h.notificationAsync(notify[name]) : h.selectionAsync();
    void play.catch(() => {});
  };
}
