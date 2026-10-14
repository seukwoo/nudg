// Plain-text views of diagnostics and simulations, shared by the CLI and MCP server.

import type { Comparison } from "../core/compare.ts";
import type { HostJudgement, HostSummary } from "../core/observe.ts";
import { describeEvent, type Simulation } from "../core/simulate.ts";
import type { Diagnostic } from "../core/types.ts";

export function formatDiagnostic(d: Diagnostic): string {
  const where = `${d.file ? `${d.file} ` : ""}${d.path || "/"}`;
  return [`  ${d.severity} ${d.code} at ${where}`, `    ${d.message}`, ...(d.hint ? [`    hint: ${d.hint}`] : [])].join("\n");
}

export function formatStatus(diagnostics: Diagnostic[]): string {
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.length - errors;
  const status = errors ? `${errors} error${errors > 1 ? "s" : ""}` : "ok";
  return `${status}${warnings ? `, ${warnings} warning${warnings > 1 ? "s" : ""}` : ""}`;
}

const fmt = (v: unknown) => (typeof v === "number" ? v.toFixed(3) : String(v));

export function formatSamples(sim: Simulation, keys: string[]): string {
  const rows = sim.samples.map((s) => [s.t.toFixed(3), s.state.join(" "), ...keys.map((k) => fmt(s.values[k]))]);
  const header = ["t", "state", ...keys];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join("  ").trimEnd();
  return [line(header), ...rows.map(line)].join("\n");
}

export function formatSummary(sim: Simulation, keys: string[]): string {
  const keyWidth = Math.max(...keys.map((k) => k.length));
  const lines = keys.map((key) => {
    const s = sim.summary[key];
    const parts = [`final ${fmt(s.final)}`];
    if (s.min !== undefined && s.max !== undefined) parts.push(`min ${fmt(s.min)}`, `max ${fmt(s.max)}`);
    parts.push(s.settledAt === undefined ? "still moving" : `at rest from ${s.settledAt.toFixed(3)}s`);
    return `  ${key.padEnd(keyWidth)}  ${parts.join("  ")}`;
  });
  if (sim.unhandled.length) lines.push(`unhandled: ${sim.unhandled.map(describeEvent).join(", ")}`);
  return lines.join("\n");
}

/** The comparison as the judge should read it: verdict first, then per property, then the proposal. */
export function formatComparison(c: Comparison, labels: [string, string] = ["A", "B"]): string {
  const lines = [c.headline, ""];
  for (const p of c.properties) lines.push(`  ${p.summary}`);
  if (c.suggestion) lines.push("", `Next: ${c.suggestion}`);
  if (c.a.unhandled.length) lines.push(`unhandled in ${labels[0]}: ${c.a.unhandled.map(describeEvent).join(", ")}`);
  if (c.b.unhandled.length) lines.push(`unhandled in ${labels[1]}: ${c.b.unhandled.map(describeEvent).join(", ")}`);
  return lines.join("\n");
}

/** What the page did, property by property, then the judgement against the file if there is one. */
export function formatObservation(o: { url: string; selector: string; summary: HostSummary; marks: { t: number; action: string }[] }, judgement?: HostJudgement): string {
  const lines: string[] = [];
  if (judgement) lines.push(judgement.headline, "");
  lines.push(`${o.selector} on ${o.url}, after ${o.marks.map((m) => `${m.action} at ${m.t.toFixed(2)}s`).join(", ") || "no actions"}:`);
  const moved = Object.entries(o.summary.properties).filter(([, p]) => p.changed);
  const shown = moved.filter(([k]) => !(k === "scaleX" || k === "scaleY") || !(o.summary.properties.scale?.changed));
  for (const [key, p] of shown) {
    const f = (v: number) => (["scale", "scaleX", "scaleY", "opacity"].includes(key) ? v.toFixed(3) : v.toFixed(1));
    const parts = [`${f(p.min!)} … ${f(p.max!)}`, `final ${f(p.final as number)}`];
    if ((p.overshoot ?? 0) > 0) parts.push(`overshoot ${f(p.overshoot!)}`);
    parts.push(p.settledAt === undefined ? "still moving at the end" : `at rest from ${p.settledAt.toFixed(2)}s`);
    lines.push(`  ${key}: ${parts.join("; ")}`);
  }
  if (o.summary.still.length) lines.push(`  unchanged: ${o.summary.still.filter((k) => k !== "scaleX" && k !== "scaleY").join(", ")}`);
  if (o.summary.unmountedAt !== undefined) lines.push(`  the element left the page at ${o.summary.unmountedAt.toFixed(2)}s`);
  if (o.summary.remountedAt !== undefined) lines.push(`  a new element took the selector's place at ${o.summary.remountedAt.toFixed(2)}s`);
  lines.push(`  measured every ${(o.summary.frameInterval * 1000).toFixed(0)} ms`);
  if (judgement) {
    lines.push("", "Against the file:");
    for (const p of judgement.properties) lines.push(`  ${p.summary}`);
    if (judgement.suggestion) lines.push("", judgement.suggestion);
  }
  return lines.join("\n");
}
