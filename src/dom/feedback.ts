// What a cue (1.3) plays in a browser: a haptic where the device can, and a sound from the
// host's map. Web Haptics (navigator.playHaptics, in incubation) takes intent names; until it
// ships, Android browsers vibrate a short pattern per intent. Desktop and iOS browsers have
// neither, so haptics there are silent, which the platforms' own guidance allows.

import type { FiredCue } from "../core/runtime.ts";

export interface FeedbackOptions {
  /** Sound names to URLs: { pop: "/sfx/pop.mp3" }. A cue whose sound isn't here plays no sound. */
  sounds?: Record<string, string>;
  /** Default true. The app's mute: false plays no sounds. A function is asked at each cue, so it follows the
   *  app's switch while the player runs. */
  sound?: boolean | (() => boolean);
  /** Default true. False plays no haptics (the host's own setting). A function is asked at each cue. */
  haptics?: boolean | (() => boolean);
}

/** Web Haptics' intents, for the nudg intents that have one. */
const WEB_HAPTICS: Record<string, string> = { tick: "tick", select: "tick", light: "hint", soft: "hint", medium: "hint", heavy: "edge", rigid: "edge", align: "align", edge: "edge", success: "align", warning: "edge", error: "edge" };
/** Milliseconds for `navigator.vibrate`, per intent: short for ticks, patterns for outcomes. */
const VIBRATION: Record<string, number | number[]> = { tick: 6, select: 8, light: 10, soft: 12, medium: 16, heavy: 24, rigid: 10, align: 8, edge: 14, success: [10, 50, 14], warning: [18, 60, 18], error: [24, 40, 24, 40, 24] };

/**
 * The `navigator.vibrate` pattern for an intent at an intensity. `vibrate` has no amplitude, so a weaker cue
 * vibrates for less time: each pulse is scaled by 0.35 + 0.65 × intensity (at least 3 ms); pauses keep their length.
 * At intensity 1 the pattern is the intent's own.
 */
export function vibration(name: string, intensity: number): number | number[] | undefined {
  const pattern = VIBRATION[name];
  if (pattern === undefined) return undefined;
  const k = 0.35 + 0.65 * Math.min(1, Math.max(0, intensity));
  const pulse = (ms: number) => Math.max(3, Math.round(ms * k));
  return typeof pattern === "number" ? pulse(pattern) : pattern.map((ms, i) => (i % 2 === 0 ? pulse(ms) : ms));
}

/** Audio elements per URL, decoded once and cloned to overlap. */
const loaded = new Map<string, HTMLAudioElement>();

/** A switch: on unless false, or what its function says now. */
const on = (v: boolean | (() => boolean) | undefined) => (typeof v === "function" ? v() !== false : v !== false);

export function playFeedback(cue: FiredCue, options: FeedbackOptions): void {
  if (cue.haptic && on(options.haptics) && cue.intensity > 0) haptic(cue.haptic, cue.intensity);
  const url = cue.sound ? options.sounds?.[cue.sound] : undefined;
  if (url && on(options.sound) && typeof Audio === "function") {
    let base = loaded.get(url);
    if (!base) loaded.set(url, (base = new Audio(url)));
    const audio = base.cloneNode() as HTMLAudioElement;
    audio.volume = Math.min(1, Math.max(0, cue.intensity));
    // A pitch in semitones, as a speed change that doesn't keep the pitch.
    if (cue.pitch) {
      (audio as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = false;
      audio.playbackRate = Math.pow(2, cue.pitch / 12);
    }
    void audio.play().catch(() => {});
  }
}

function haptic(name: string, intensity: number) {
  if (typeof navigator === "undefined") return;
  const nav = navigator as Navigator & { playHaptics?: (effect: string, intensity?: number) => unknown };
  const effect = WEB_HAPTICS[name];
  if (effect && typeof nav.playHaptics === "function") {
    try {
      nav.playHaptics(effect, intensity);
      return;
    } catch {}
  }
  const pattern = vibration(name, intensity);
  if (pattern !== undefined && typeof nav.vibrate === "function") nav.vibrate(pattern);
}
