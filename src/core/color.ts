// Colors are stored and interpolated in OKLab: [L, a, b, alpha].

import type { Channels } from "./types.ts";

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value);
}

export function hexToOklab(hex: string): Channels {
  let digits = hex.slice(1);
  if (digits.length === 3) digits = [...digits].map((d) => d + d).join("");
  const byte = (i: number) => parseInt(digits.slice(i, i + 2), 16) / 255;
  const alpha = digits.length === 8 ? byte(6) : 1;
  return [...linearSrgbToOklab(toLinear(byte(0)), toLinear(byte(2)), toLinear(byte(4))), alpha];
}

export function oklabToHex(channels: Channels): string {
  const [L, a, b, alpha] = channels;
  const [r, g, bl] = oklabToLinearSrgb(L, a, b).map(fromLinear);
  const out = [r, g, bl].map(toByteHex).join("");
  const alphaByte = Math.round(clamp01(alpha) * 255);
  return "#" + out + (alphaByte === 255 ? "" : toByteHex(alpha));
}

function toByteHex(c: number): string {
  return Math.round(clamp01(c) * 255).toString(16).padStart(2, "0");
}

function clamp01(c: number): number {
  return Math.min(1, Math.max(0, c));
}

function toLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function fromLinear(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

function linearSrgbToOklab(r: number, g: number, b: number): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLinearSrgb(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/**
 * A color as an app writes it, as #RRGGBBAA, or undefined: hex, rgb()/rgba() and hsl()/hsla()
 * (comma or space syntax, alpha as a number or a percent), and "transparent". What a native
 * theme or a React Native style holds; the DOM adapter lets the browser parse every CSS color.
 */
export function colorToHex(value: string): string | undefined {
  const text = value.trim().toLowerCase();
  if (isHexColor(text)) return text;
  if (text === "transparent") return "#00000000";
  const m = /^(rgba?|hsla?)\(\s*([^)]*)\)$/.exec(text);
  if (!m) return undefined;
  const parts = m[2].split(/\s*[,/]\s*|\s+/).filter(Boolean);
  if (parts.length !== 3 && parts.length !== 4) return undefined;
  const num = (s: string, percentOf: number): number | undefined => {
    const n = parseFloat(s);
    if (!Number.isFinite(n) || !/^-?(\d+\.?\d*|\.\d+)(%|deg)?$/.test(s)) return undefined;
    return s.endsWith("%") ? (n / 100) * percentOf : n;
  };
  const alpha = parts.length === 4 ? num(parts[3], 1) : 1;
  let rgb: (number | undefined)[];
  if (m[1].startsWith("rgb")) rgb = parts.slice(0, 3).map((p) => num(p, 255)).map((c) => (c === undefined ? c : c / 255));
  else {
    const [h, s, l] = [num(parts[0], 360), num(parts[1], 1), num(parts[2], 1)];
    if (h === undefined || s === undefined || l === undefined) return undefined;
    const f = (k: number) => {
      const n = (k + h / 30) % 12;
      return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(n - 3, 9 - n, 1));
    };
    rgb = [f(0), f(8), f(4)];
  }
  if (alpha === undefined || rgb.some((c) => c === undefined)) return undefined;
  return "#" + [...(rgb as number[]), alpha].map(toByteHex).join("");
}
