// Motion graphs: one small panel per property over a shared time axis, with events,
// targets, extremes and settle times marked. Pure string output, so any platform
// (and any multimodal model) can use it.

import { simulate, type SimulateOptions, type Simulation } from "./simulate.ts";
import type { Program } from "./types.ts";

export interface PlotOptions extends SimulateOptions {
  title?: string;
  /** Total width in px. Default 760. */
  width?: number;
}

export interface Plot {
  svg: string;
  width: number;
  height: number;
  simulation: Simulation;
}

const SAMPLE_RATE = 240;
const MARGIN = { left: 64, right: 28, top: 16 };
const PANEL = { height: 112 };
const STRIP = { height: 24 };
/** Space between blocks: room for a settle label below and the next title above. */
const GAP = 48;
const BAND = { height: 22, gap: 4 };

export function plot(program: Program, options: PlotOptions): Plot {
  const width = options.width ?? 760;
  const simulation = simulate(program, { ...options, every: 1 / SAMPLE_RATE });
  const { samples, summary } = simulation;
  const keys = options.properties ?? [...program.properties.keys()];
  const until = samples[samples.length - 1].t;
  const plotW = width - MARGIN.left - MARGIN.right;
  const x = (t: number) => MARGIN.left + (until ? (t / until) * plotW : 0);
  const out: string[] = [];
  let y = MARGIN.top;

  // Title and the event script.
  out.push(text(MARGIN.left, y + 14, options.title ?? "nudg", "title"));
  y += 22;
  const script = describeScript(options.events);
  // Wrap the script to the plot width (monospace, about 7 px per character at 12 px).
  const perLine = Math.max(20, Math.floor((width - MARGIN.left - MARGIN.right) / 7.3));
  const lines: string[] = [];
  for (const part of (script || "no events").split("  ·  ")) {
    const last = lines.length - 1;
    if (last >= 0 && lines[last].length + part.length + 5 <= perLine) lines[last] += `  ·  ${part}`;
    else lines.push(part);
  }
  for (const line of lines) {
    out.push(text(MARGIN.left, y + 12, line, "subtitle"));
    y += 18;
  }
  y += 8;

  // State bands, one row per region.
  const regionOf = (path: string) => (path.includes("/") ? path.slice(0, path.indexOf("/")) : "");
  const regions = [...new Set(samples.flatMap((s) => s.state.map(regionOf)))];
  const bandTop = y;
  for (const region of regions) {
    out.push(text(MARGIN.left - 8, y + 15, region || "state", "axis", "end"));
    let runStart = 0;
    let current = stateIn(samples[0].state, region);
    for (let i = 1; i <= samples.length; i++) {
      const next = i < samples.length ? stateIn(samples[i].state, region) : undefined;
      if (next === current) continue;
      const x0 = x(samples[runStart].t);
      const x1 = x(i < samples.length ? samples[i].t : until);
      out.push(`<rect class="band" x="${r(x0)}" y="${r(y)}" width="${r(Math.max(0, x1 - x0 - 2))}" height="${BAND.height}" rx="4"/>`);
      // Only label a band the name fits in (monospace, about 6.7 px per character at 11 px).
      const name = label(current, region);
      if (x1 - x0 - 2 >= name.length * 6.7 + 12) out.push(text(x0 + 6, y + 15, name, "band-label"));
      runStart = i;
      current = next ?? current;
    }
    y += BAND.height + BAND.gap;
  }
  y += GAP - BAND.gap;

  const plotTop = bandTop;
  const panels: string[] = [];
  for (const key of keys) {
    const kind = program.properties.get(key)!.kind;
    const values = samples.map((s) => s.values[key]);
    const s = summary[key];

    if (kind === "color") {
      panels.push(text(MARGIN.left, y - 12, key, "panel-title"));
      for (let i = 0; i < samples.length - 1; i++) {
        const x0 = x(samples[i].t);
        const x1 = x(samples[i + 1].t);
        panels.push(`<rect x="${r(x0)}" y="${r(y)}" width="${r(x1 - x0 + 0.5)}" height="${STRIP.height}" fill="${values[i]}"/>`);
      }
      panels.push(`<rect class="frame" x="${MARGIN.left}" y="${r(y)}" width="${r(plotW)}" height="${STRIP.height}"/>`);
      if (s.settledAt !== undefined) panels.push(settleMark(x(s.settledAt), y + STRIP.height, s.settledAt, MARGIN.left + plotW));
      y += STRIP.height + GAP;
      continue;
    }

    const nums = values as number[];
    const target = nums[nums.length - 1];
    const start = nums[0];
    let lo = Math.min(...nums, target);
    let hi = Math.max(...nums, target);
    if (hi - lo < 1e-9) {
      lo -= 1;
      hi += 1;
    }
    const ticks = niceTicks(lo, hi, 3);
    lo = Math.min(lo, ticks[0]);
    hi = Math.max(hi, ticks[ticks.length - 1]);
    const py = (v: number) => y + PANEL.height - ((v - lo) / (hi - lo)) * PANEL.height;

    panels.push(text(MARGIN.left, y - 12, key, "panel-title"));
    for (const tick of ticks) {
      panels.push(`<line class="grid" x1="${MARGIN.left}" x2="${MARGIN.left + plotW}" y1="${r(py(tick))}" y2="${r(py(tick))}"/>`);
      panels.push(text(MARGIN.left - 8, py(tick) + 4, fmt(tick), "axis", "end"));
    }
    panels.push(`<line class="target" x1="${MARGIN.left}" x2="${MARGIN.left + plotW}" y1="${r(py(target))}" y2="${r(py(target))}"/>`);
    const points = nums.map((v, i) => `${r(x(samples[i].t))},${r(py(v))}`).join(" ");
    panels.push(`<polyline class="series" points="${points}"/>`);

    // Extremes outside the start-to-target range: overshoot, a kick's pop, a dip.
    // Located on the drawn samples, labeled with the finer-grained summary values.
    const span = Math.abs(target - start);
    const eps = Math.max(span, hi - lo) * 0.002;
    let iMax = 0;
    let iMin = 0;
    nums.forEach((v, j) => {
      if (v > nums[iMax]) iMax = j;
      if (v < nums[iMin]) iMin = j;
    });
    const marks: [number, string, boolean][] = [];
    if ((s.max ?? hi) > Math.max(start, target) + eps) marks.push([iMax, `max ${fmt(s.max!)}`, true]);
    if ((s.min ?? lo) < Math.min(start, target) - eps) marks.push([iMin, `min ${fmt(s.min!)}`, false]);
    for (const [i, note, above] of marks) {
      const px = x(samples[i].t);
      const ppy = py(nums[i]);
      panels.push(`<circle class="peak" cx="${r(px)}" cy="${r(ppy)}" r="4"/>`);
      const anchor = px > MARGIN.left + plotW * 0.8 ? "end" : "start";
      panels.push(text(px + (anchor === "end" ? -8 : 8), ppy + (above ? -6 : 14), note, "note", anchor));
    }
    if (s.settledAt !== undefined) panels.push(settleMark(x(s.settledAt), y + PANEL.height, s.settledAt, MARGIN.left + plotW));
    y += PANEL.height + GAP;
  }

  // Event markers span the bands and every panel.
  const events: string[] = [];
  const markedTimes = new Set<number>();
  for (const e of options.events) {
    if (!("event" in e) || e.t > until || markedTimes.has(e.t)) continue;
    markedTimes.add(e.t);
    events.push(`<line class="event" x1="${r(x(e.t))}" x2="${r(x(e.t))}" y1="${r(plotTop - 6)}" y2="${r(y - GAP + 26)}"/>`);
  }

  // Time axis.
  const axis: string[] = [];
  // Below the last block's settle label.
  const axisY = y - GAP + 26;
  for (const tick of niceTicks(0, until, 6)) {
    if (tick > until + 1e-9) continue;
    axis.push(`<line class="grid" x1="${r(x(tick))}" x2="${r(x(tick))}" y1="${r(axisY)}" y2="${r(axisY + 4)}"/>`);
    axis.push(text(x(tick), axisY + 18, `${fmt(tick)}s`, "axis", "middle"));
  }
  const height = Math.ceil(axisY + 30);

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">`,
    `<title>${escape(options.title ?? "nudg motion graph")}</title>`,
    `<desc>${escape(describe(keys, summary, script))}</desc>`,
    `<style>${STYLE}</style>`,
    `<rect class="surface" width="${width}" height="${height}"/>`,
    ...out,
    ...panels,
    ...events,
    ...axis,
    `</svg>`,
  ].join("\n");
  return { svg, width, height, simulation };
}

const STYLE = `
svg { --surface: #fcfcfb; --text: #0b0b0b; --muted: #52514e; --faint: #8a8984; --grid: #e7e6e2; --band: #efeeea; --series: #2a78d6;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
@media (prefers-color-scheme: dark) {
  svg { --surface: #1a1a19; --text: #f0efec; --muted: #c3c2b7; --faint: #8f8e86; --grid: #2e2e2b; --band: #2a2a27; --series: #3987e5; }
}
.surface { fill: var(--surface); }
.title { font-size: 15px; font-weight: 600; fill: var(--text); }
.subtitle { font-size: 12px; fill: var(--muted); font-family: ui-monospace, "SF Mono", Menlo, monospace; }
.panel-title { font-size: 12px; font-weight: 600; fill: var(--text); font-family: ui-monospace, "SF Mono", Menlo, monospace; }
.axis { font-size: 11px; fill: var(--muted); font-variant-numeric: tabular-nums; }
.note { font-size: 11px; fill: var(--text); font-variant-numeric: tabular-nums; }
.band { fill: var(--band); }
.band-label { font-size: 11px; fill: var(--text); font-family: ui-monospace, "SF Mono", Menlo, monospace; }
.grid { stroke: var(--grid); stroke-width: 1; }
.target { stroke: var(--faint); stroke-width: 1; stroke-dasharray: 4 4; }
.series { fill: none; stroke: var(--series); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.peak { fill: var(--series); stroke: var(--surface); stroke-width: 2; }
.event { stroke: var(--faint); stroke-width: 1; stroke-dasharray: 2 3; }
.settle { stroke: var(--muted); stroke-width: 1.5; }
.frame { fill: none; stroke: var(--grid); }
`;

/**
 * Events in time order, without helper-added ones; each input's samples summarized as
 * one entry, e.g. "track.drag.x 0→8 (15 samples)".
 */
function describeScript(events: PlotOptions["events"]): string {
  const parts: string[] = [];
  const inputs = new Map<string, { first: number; last: number; count: number; at: number }>();
  for (const e of [...events].sort((a, b) => a.t - b.t)) {
    if ("event" in e) {
      if (e.implied) continue;
      parts.push(`${e.event} @ ${fmt(e.t)}s`);
      continue;
    }
    const seen = inputs.get(e.input);
    if (seen) Object.assign(seen, { last: e.value, count: seen.count + 1 });
    else {
      inputs.set(e.input, { first: e.value, last: e.value, count: 1, at: parts.length });
      parts.push("");
    }
  }
  for (const [name, s] of inputs) parts[s.at] = `${name} ${fmt(s.first)}→${fmt(s.last)} (${s.count} samples)`;
  return parts.join("  ·  ");
}

function settleMark(px: number, bottom: number, at: number, right: number): string {
  const nearEdge = px > right - 48;
  return [
    `<line class="settle" x1="${r(px)}" x2="${r(px)}" y1="${r(bottom - 6)}" y2="${r(bottom + 4)}"/>`,
    text(nearEdge ? right : px, bottom + 17, `at rest ${fmt(at)}s`, "note", nearEdge ? "end" : "middle"),
  ].join("\n");
}

function stateIn(paths: string[], region: string): string {
  return paths.find((p) => (region ? p.startsWith(`${region}/`) : !p.includes("/"))) ?? paths.find((p) => p.startsWith(region)) ?? "";
}

function label(path: string, region: string): string {
  return region && path.startsWith(`${region}/`) ? path.slice(region.length + 1) : path;
}

function describe(keys: string[], summary: Simulation["summary"], script: string): string {
  const parts = keys.map((k) => {
    const s = summary[k];
    const range = s.min !== undefined ? `, range ${fmt(s.min)} to ${fmt(s.max!)}` : "";
    return `${k}: final ${typeof s.final === "number" ? fmt(s.final) : s.final}${range}${s.settledAt !== undefined ? `, at rest from ${fmt(s.settledAt)}s` : ", still moving"}`;
  });
  return `Events: ${script || "none"}. ${parts.join("; ")}.`;
}

/** Up to about `count` round tick values covering [lo, hi]. */
function niceTicks(lo: number, hi: number, count: number): number[] {
  const span = hi - lo || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const ticks: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 1e-6; v += step) ticks.push(Math.round(v / step) * step);
  if (ticks[ticks.length - 1] < hi - 1e-9) ticks.push(ticks[ticks.length - 1] + step);
  return ticks.map((t) => Number(t.toPrecision(12)));
}

function text(x: number, y: number, content: string, cls: string, anchor: "start" | "middle" | "end" = "start"): string {
  return `<text class="${cls}" x="${r(x)}" y="${r(y)}"${anchor === "start" ? "" : ` text-anchor="${anchor}"`}>${escape(content)}</text>`;
}

function fmt(n: number): string {
  return String(Number(n.toFixed(Math.abs(n) >= 100 ? 1 : Math.abs(n) >= 10 ? 2 : 3)));
}

function r(n: number): string {
  return String(Math.round(n * 10) / 10);
}

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
