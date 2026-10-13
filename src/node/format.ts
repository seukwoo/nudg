// Plain-text views of diagnostics and simulations, shared by the CLI and MCP server.

import type { Simulation } from "../core/simulate.ts";
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
  if (sim.unhandled.length) lines.push(`unhandled: ${sim.unhandled.map((e) => `${e.event}@${e.t}`).join(", ")}`);
  return lines.join("\n");
}
