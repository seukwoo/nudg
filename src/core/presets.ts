// Presets: the common interactions as ready-made nudg documents, so the simple case is
// one line and needs no file. Each returns a plain document; save it as a file when you
// want to change more than the options cover (`nudg preset press > press.nudg.json`).

export type NudgDocument = Record<string, unknown>;

export interface SpringOptions {
  /** Perceptual duration in seconds. */
  duration?: number;
  /** 0 is no overshoot; 0.3 is lively. */
  bounce?: number;
}

const spring = (o: SpringOptions, duration: number, bounce: number) => ({
  spring: { duration: o.duration ?? duration, bounce: o.bounce ?? bounce },
});

export interface PressOptions {
  /** The target name to bind, default "button". */
  target?: string;
  /** Scale while pressed, default 0.96. */
  scale?: number;
  /** How far it sinks while pressed, in logical units, default 0. */
  y?: number;
  /** The spring going down: quick and flat by default. */
  sink?: SpringOptions;
  /** The spring coming back up: a little bouncy by default. */
  release?: SpringOptions;
}

/** A button that sinks while pressed and springs back on release. */
export function press(options: PressOptions = {}): NudgDocument {
  const t = options.target ?? "button";
  const scale = options.scale ?? 0.96;
  const y = options.y ?? 0;
  const values: Record<string, number> = {};
  const down: Record<string, number> = {};
  const release: Record<string, unknown> = {};
  const sink: Record<string, unknown> = {};
  if (scale !== 1) {
    values[`${t}.scale`] = 1;
    down[`${t}.scale`] = scale;
    release[`${t}.scale`] = spring(options.release ?? {}, 0.3, 0.35);
    sink[`${t}.scale`] = spring(options.sink ?? {}, 0.12, 0);
  }
  if (y !== 0) {
    values[`${t}.y`] = 0;
    down[`${t}.y`] = y;
    release[`${t}.y`] = spring(options.release ?? {}, 0.3, 0.35);
    sink[`${t}.y`] = spring(options.sink ?? {}, 0.12, 0);
  }
  return {
    nudg: "0.3",
    note: "presets.press(): sinks while pressed, springs back on release. Save this file to change more than the options cover.",
    targets: [t],
    values,
    animate: release,
    initial: "up",
    states: {
      up: { when: { [`${t}.down`]: { to: "down", animate: sink } } },
      down: { set: down, when: { [`${t}.up`]: "up", [`${t}.cancel`]: "up" } },
    },
  };
}

export interface HoverOptions {
  target?: string;
  /** Lift while hovered, in logical units (negative is up), default -4. */
  lift?: number;
  /** Scale while hovered, default 1. */
  scale?: number;
  motion?: SpringOptions;
}

/** Lifts (and optionally grows) while a mouse or pen hovers. */
export function hover(options: HoverOptions = {}): NudgDocument {
  const t = options.target ?? "card";
  const lift = options.lift ?? -4;
  const scale = options.scale ?? 1;
  const values: Record<string, number> = {};
  const over: Record<string, number> = {};
  const animate: Record<string, unknown> = {};
  if (lift !== 0) {
    values[`${t}.y`] = 0;
    over[`${t}.y`] = lift;
    animate[`${t}.y`] = spring(options.motion ?? {}, 0.3, 0.2);
  }
  if (scale !== 1) {
    values[`${t}.scale`] = 1;
    over[`${t}.scale`] = scale;
    animate[`${t}.scale`] = spring(options.motion ?? {}, 0.3, 0.2);
  }
  return {
    nudg: "0.3",
    note: "presets.hover(): lifts while hovered. Save this file to change more than the options cover.",
    targets: [t],
    values,
    animate,
    initial: "idle",
    states: {
      idle: { when: { [`${t}.hoverstart`]: "over" } },
      over: { set: over, when: { [`${t}.hoverend`]: "idle" } },
    },
  };
}

export interface ToggleOptions {
  /** Target names, default "knob" and "track". */
  knob?: string;
  track?: string;
  /** How far the knob travels, default 20. */
  travel?: number;
  /** Track colors off and on; omit for no color change. */
  colors?: [string, string];
  motion?: SpringOptions;
  /** Initial state, default "off". */
  initial?: "off" | "on";
}

/** An on/off switch: the knob springs across, the track color fades; tap toggles, the app can set it. */
export function toggle(options: ToggleOptions = {}): NudgDocument {
  const knob = options.knob ?? "knob";
  const track = options.track ?? "track";
  const travel = options.travel ?? 20;
  const values: Record<string, unknown> = { [`${knob}.x`]: 0 };
  const on: Record<string, unknown> = { [`${knob}.x`]: travel };
  const animate: Record<string, unknown> = { [`${knob}.x`]: spring(options.motion ?? {}, 0.35, 0.25) };
  if (options.colors) {
    values[`${track}.color`] = options.colors[0];
    on[`${track}.color`] = options.colors[1];
    animate[`${track}.color`] = { tween: { duration: 0.2, ease: "out" } };
  }
  return {
    nudg: "0.3",
    note: "presets.toggle(): tap to switch; host.check / host.uncheck set it. Save this file to change more than the options cover.",
    targets: [knob, track],
    values,
    animate,
    initial: options.initial ?? "off",
    when: { "host.check": "on", "host.uncheck": "off" },
    states: {
      off: { when: { [`${track}.tap`]: "on" } },
      on: { set: on, when: { [`${track}.tap`]: "off" } },
    },
  };
}

export interface ToastOptions {
  target?: string;
  /** Seconds it stays before hiding itself, default 3; 0 means until tapped or hidden by the app. */
  duration?: number;
  /** Where it starts from, in logical units below its resting place, default 12. */
  rise?: number;
  motion?: SpringOptions;
}

/** A notice the app shows (host.show); it rises in, hides itself after a while or on tap. */
export function toast(options: ToastOptions = {}): NudgDocument {
  const t = options.target ?? "toast";
  const duration = options.duration ?? 3;
  const shownWhen: Record<string, string> = { [`${t}.tap`]: "hidden" };
  if (duration > 0) shownWhen[`after:${duration}s`] = "hidden";
  return {
    nudg: "0.3",
    note: "presets.toast(): the app sends host.show; it hides itself after a while or on tap. Save this file to change more than the options cover.",
    targets: [t],
    values: { [`${t}.y`]: options.rise ?? 12, [`${t}.opacity`]: 0 },
    animate: {
      [`${t}.y`]: spring(options.motion ?? {}, 0.4, 0.25),
      [`${t}.opacity`]: { tween: { duration: 0.2, ease: "out" } },
    },
    initial: "hidden",
    when: { "host.show": "shown", "host.hide": "hidden" },
    states: {
      hidden: {},
      shown: { set: { [`${t}.y`]: 0, [`${t}.opacity`]: 1 }, when: shownWhen },
    },
  };
}

export const presets = { press, hover, toggle, toast };
export type PresetName = keyof typeof presets;
