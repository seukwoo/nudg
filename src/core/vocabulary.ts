import type { PropertyKind } from "./types.ts";

/** The newest format version; every listed version is read. */
export const VERSION = "0.13";
export const VERSIONS = ["0.1", "0.2", "0.3", "0.4", "0.5", "0.6", "0.7", "0.8", "0.9", "0.10", "0.11", "0.12", "0.13"];

/** What a host reports about each target's layout, as target.layout.<name> inputs (v0.4). */
export const MEASUREMENTS = ["x", "y", "width", "height", "naturalWidth", "naturalHeight"] as const;
export type Measurement = (typeof MEASUREMENTS)[number];

/** Platform-neutral properties (design decision 1). Adapters translate them. */
export const PROPERTIES: Record<string, PropertyKind> = {
  x: "length",
  y: "length",
  width: "length",
  height: "length",
  scale: "number",
  scaleX: "number",
  scaleY: "number",
  rotation: "number",
  opacity: "number",
  color: "color",
};

/** Names an AI or a person is likely to reach for, mapped to the nudg name. */
export const PROPERTY_ALIASES: Record<string, string> = {
  translateX: "x",
  translateY: "y",
  left: "x",
  top: "y",
  rotate: "rotation",
  angle: "rotation",
  alpha: "opacity",
  backgroundColor: "color",
  background: "color",
  fill: "color",
};

export const EVENTS = ["down", "up", "cancel", "tap", "dragstart", "dragend", "hoverstart", "hoverend", "focus", "blur"] as const;
/** Events that need format 0.2. */
export const EVENTS_0_2 = ["dragstart", "dragend", "hoverstart", "hoverend", "focus", "blur"];
/** Inputs a target can supply, as target.<input> (v0.2). */
export const INPUTS = ["drag.x", "drag.y"];
/** Event and target prefix for events the app sends: host.<name>. */
export const HOST = "host";
/** Named keys for target.key.<name> events (v0.3); single characters are also allowed. */
export const KEY_NAMES = ["space", "enter", "escape", "tab", "backspace", "delete", "arrowup", "arrowdown", "arrowleft", "arrowright", "home", "end", "pageup", "pagedown"];
export const KEY_NAME = /^(?:[a-z0-9]|[^\sA-Za-z0-9+]|f(?:[1-9]|1[0-2]))$/;
/** Spellings people reach for, mapped to the nudg key name. */
export const KEY_ALIASES: Record<string, string> = {
  " ": "space",
  spacebar: "space",
  return: "enter",
  esc: "escape",
  del: "delete",
  up: "arrowup",
  down: "arrowdown",
  left: "arrowleft",
  right: "arrowright",
};

export const EVENT_ALIASES: Record<string, string> = {
  click: "tap",
  press: "down",
  pointerdown: "down",
  mousedown: "down",
  touchstart: "down",
  release: "up",
  pointerup: "up",
  mouseup: "up",
  touchend: "up",
  pointercancel: "cancel",
  touchcancel: "cancel",
  pan: "dragstart",
  panstart: "dragstart",
  panend: "dragend",
  mouseenter: "hoverstart",
  pointerenter: "hoverstart",
  mouseleave: "hoverend",
  pointerleave: "hoverend",
  hover: "hoverstart",
};

export const NAMED_EASES: Record<string, readonly [number, number, number, number] | "linear"> = {
  linear: "linear",
  in: [0.42, 0, 1, 1],
  out: [0, 0, 0.58, 1],
  "in-out": [0.42, 0, 0.58, 1],
  // The classic curve families, as cubic Béziers. Bounce and elastic are springs, not curves.
  "in-sine": [0.12, 0, 0.39, 0],
  "out-sine": [0.61, 1, 0.88, 1],
  "in-out-sine": [0.37, 0, 0.63, 1],
  "in-quad": [0.11, 0, 0.5, 0],
  "out-quad": [0.5, 1, 0.89, 1],
  "in-out-quad": [0.45, 0, 0.55, 1],
  "in-cubic": [0.32, 0, 0.67, 0],
  "out-cubic": [0.33, 1, 0.68, 1],
  "in-out-cubic": [0.65, 0, 0.35, 1],
  "in-quart": [0.5, 0, 0.75, 0],
  "out-quart": [0.25, 1, 0.5, 1],
  "in-out-quart": [0.76, 0, 0.24, 1],
  "in-quint": [0.64, 0, 0.78, 0],
  "out-quint": [0.22, 1, 0.36, 1],
  "in-out-quint": [0.83, 0, 0.17, 1],
  "in-expo": [0.7, 0, 0.84, 0],
  "out-expo": [0.16, 1, 0.3, 1],
  "in-out-expo": [0.87, 0, 0.13, 1],
  "in-circ": [0.55, 0, 1, 0.45],
  "out-circ": [0, 0.55, 0.45, 1],
  "in-out-circ": [0.85, 0, 0.15, 1],
  "in-back": [0.36, 0, 0.66, -0.56],
  "out-back": [0.34, 1.56, 0.64, 1],
  "in-out-back": [0.68, -0.6, 0.32, 1.6],
};

export const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_-]*$/;
