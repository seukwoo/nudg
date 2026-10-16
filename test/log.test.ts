// The local judge log: written by the tools, summarized by `nudg log`, off with NUDG_LOG=off.

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { summarize, type LogEntry } from "../src/node/log.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const cli = (log: string, ...args: string[]) => execFileSync(process.execPath, [join(root, "src/cli.ts"), ...args], { cwd: root, encoding: "utf8", env: { ...process.env, NUDG_LOG: log, NUDG_OPEN: "false" } });

test("the CLI appends one line per validate and compare, and nudg log counts rounds per change", () => {
  const dir = mkdtempSync(join(tmpdir(), "nudg-log-"));
  const log = join(dir, "log.jsonl");
  try {
    cli(log, "validate", "examples/toggle.nudg.json");
    for (let i = 0; i < 3; i++) cli(log, "compare", "examples/toggle.nudg.json", "examples/toggle-press.nudg.json", "--send", "track.down@0.05");
    const lines = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(lines.length, 4);
    assert.deepEqual(lines.map((l) => l.tool), ["validate", "compare", "compare", "compare"]);
    assert.equal(lines[1].via, "cli");
    assert.deepEqual(lines[1].files, ["examples/toggle.nudg.json", "examples/toggle-press.nudg.json"]);
    const summary = JSON.parse(cli(log, "log", "--json"));
    assert.equal(summary.rounds.changes, 1, "three compares of the same file within minutes are one change");
    assert.equal(summary.rounds.max, 3);
    assert.match(cli(log, "log"), /Rounds per change: median 3, max 3/);
    assert.equal(cli(log, "log", "--path").trim(), log);
    cli(log, "log", "--clear");
    assert.equal(existsSync(log), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("NUDG_LOG=off writes nothing", () => {
  const out = cli("off", "log");
  assert.match(out, /The log is off/);
});

test("the MCP server logs its compare calls with the verdict", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nudg-log-"));
  const log = join(dir, "log.jsonl");
  const server = spawn(process.execPath, [join(root, "src/cli.ts"), "mcp"], { cwd: root, stdio: ["pipe", "pipe", "inherit"], env: { ...process.env, NUDG_LOG: log, NUDG_OPEN: "false" } });
  try {
    const replies: any[] = [];
    let buffer = "";
    server.stdout!.on("data", (c) => {
      buffer += c;
      let i: number;
      while ((i = buffer.indexOf("\n")) >= 0) {
        replies.push(JSON.parse(buffer.slice(0, i)));
        buffer = buffer.slice(i + 1);
      }
    });
    const send = (id: number, method: string, params: object) => server.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    send(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } });
    send(2, "tools/call", { name: "nudg_compare", arguments: { file: "examples/toggle.nudg.json", before: "HEAD", events: [{ event: "track.tap", t: 0.05 }] } });
    // A cold Node on a busy runner can take several seconds to answer; wait for the reply and the line.
    for (let i = 0; i < 600 && !(replies.some((r) => r.id === 2) && existsSync(log)); i++) await new Promise((r) => setTimeout(r, 50));
    assert.ok(replies.some((r) => r.id === 2), "the server answered");
    const [entry] = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(entry.via, "mcp");
    assert.equal(entry.tool, "compare");
    assert.equal(entry.before, "HEAD");
    assert.equal(entry.verdict, "identical");
    assert.deepEqual(entry.files, ["examples/toggle.nudg.json"]);
  } finally {
    server.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("summarize: chains break after 15 minutes; nothing-to-see rounds are counted", () => {
  const at = (min: number, verdict: string): LogEntry => ({ v: 1, t: new Date(Date.UTC(2026, 9, 16, 0, min)).toISOString(), via: "mcp", session: "s", tool: "compare", cwd: "/p", files: ["a", "b"], verdict });
  const s = summarize([at(0, "imperceptible"), at(5, "clear"), at(40, "clear")]);
  assert.deepEqual([s.rounds.changes, s.rounds.max, s.rounds.median], [2, 2, 1]);
  assert.equal(s.wasted, 1);
});

test("nudg skill writes a Claude Code skill", () => {
  const dir = mkdtempSync(join(tmpdir(), "nudg-skill-"));
  try {
    const out = execFileSync(process.execPath, [join(root, "src/cli.ts"), "skill"], { cwd: dir, encoding: "utf8" });
    assert.match(out, /wrote .*\.claude\/skills\/nudg\/SKILL\.md/);
    const skill = readFileSync(join(dir, ".claude", "skills", "nudg", "SKILL.md"), "utf8");
    assert.match(skill, /^---\nname: nudg\ndescription: /);
    assert.match(skill, /before: "HEAD"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("nudg log --share shows exactly what would be shared, counts only, and a prefilled issue", () => {
  const dir = mkdtempSync(join(tmpdir(), "nudg-log-"));
  const log = join(dir, "log.jsonl");
  try {
    cli(log, "compare", "examples/toggle.nudg.json", "examples/toggle-press.nudg.json", "--send", "track.down@0.05");
    const out = cli(log, "log", "--share");
    assert.match(out, /counts only/);
    assert.match(out, /https:\/\/github\.com\/seukwoo\/nudg\/issues\/new\?title=Usage\+log/);
    // Nothing about the person's app: no file names, paths, cwd or headlines.
    assert.ok(!/toggle|examples|\/Users\/|track|knob/.test(out.replace(/https:\S+/, "")), out);
    const url = decodeURIComponent(out.match(/https:\S+/)![0].replace(/\+/g, " "));
    assert.ok(!/toggle|examples|track|knob/.test(url), url);
    assert.match(url, /labels=usage-log/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the CLI suggests sharing at most once a week, and only after three judged changes", () => {
  const dir = mkdtempSync(join(tmpdir(), "nudg-log-"));
  const log = join(dir, "log.jsonl");
  const compareOnce = (b: string) => cli(log, "compare", "examples/toggle.nudg.json", b, "--send", "track.tap@0.05");
  try {
    assert.doesNotMatch(compareOnce("examples/toggle-press.nudg.json"), /tip:/);
    assert.doesNotMatch(compareOnce("examples/toggle-drag.nudg.json"), /tip:/);
    assert.match(compareOnce("examples/ios-toggle.nudg.json"), /tip: you've judged 3 motion changes[\s\S]*nudg log --share/);
    assert.doesNotMatch(compareOnce("examples/material-switch.nudg.json"), /tip:/, "not again within the week");
    assert.match(cli(log, "log"), /Please share it: `nudg log --share`/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
