// Talks to `nudg mcp` over stdio the way an MCP client does.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { findChrome } from "../src/node/chrome.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const chrome = findChrome();

let server: ReturnType<typeof spawn>;
const waiting = new Map<number, (message: any) => void>();
let nextId = 0;

function request(method: string, params: Record<string, unknown> = {}): Promise<any> {
  const id = ++nextId;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    server.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

const call = (name: string, args: Record<string, unknown>) => request("tools/call", { name, arguments: args }).then((m) => m.result);

before(async () => {
  // Never open the person's browser from a test run.
  server = spawn(process.execPath, [`${root}src/cli.ts`, "mcp"], { cwd: root, stdio: ["pipe", "pipe", "inherit"], env: { ...process.env, NUDG_OPEN: "false" } });
  let buffer = "";
  server.stdout!.on("data", (chunk) => {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const message = JSON.parse(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      waiting.get(message.id)?.(message);
      waiting.delete(message.id);
    }
  });
  const init = await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
  assert.equal(init.result.protocolVersion, "2025-06-18");
  server.stdin!.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
});

after(() => server.kill());

test("lists the tools with input schemas", async () => {
  const { result } = await request("tools/list");
  assert.deepEqual(
    result.tools.map((t: { name: string }) => t.name),
    ["nudg_guide", "nudg_recipe", "nudg_validate", "nudg_simulate", "nudg_plot", "nudg_compare", "nudg_render", "nudg_critique", "nudg_generate", "nudg_share", "nudg_observe"],
  );
  for (const tool of result.tools) assert.equal(tool.inputSchema.type, "object");
});

test("answers unknown methods and tools with JSON-RPC errors", async () => {
  assert.equal((await request("resources/list")).error.code, -32601);
  assert.equal((await request("tools/call", { name: "nope", arguments: {} })).error.code, -32602);
  assert.deepEqual((await request("ping")).result, {});
});

test("guide returns the format reference", async () => {
  const result = await call("nudg_guide", {});
  assert.match(result.content[0].text, /Words to edits/);
});

test("generate returns the host contract module", async () => {
  const result = await call("nudg_generate", { file: "examples/toggle-drag.nudg.json" });
  assert.match(result.content[0].text, /export interface ToggleDragContract \{/);
  assert.deepEqual(result.structuredContent.inputs, ["track.drag.x"]);
});

test("recipe resolves human UI terms and can return a starter", async () => {
  const listed = await call("nudg_recipe", {});
  assert.ok(listed.structuredContent.recipes.some((recipe: any) => recipe.id === "bottom-sheet"));
  const result = await call("nudg_recipe", { name: "video chat", source: true });
  assert.equal(result.structuredContent.recipe.id, "video-call");
  assert.match(result.structuredContent.source, /"host\.camera-off"/);
  const pinch = await call("nudg_recipe", { name: "pinch zoom", source: true });
  assert.equal(pinch.structuredContent.recipe.starter, "image-viewer");
  assert.match(pinch.structuredContent.source, /"multiply": true/);
  const missing = await call("nudg_recipe", { name: "mystery control" });
  assert.equal(missing.isError, true);
});

test("validate reports codes, paths and hints for inline source", async () => {
  const source = JSON.stringify({ nudg: "0.1", targets: ["a"], values: { "a.x": 0 }, initial: "s", states: { s: { sett: {} } } });
  const result = await call("nudg_validate", { source });
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.ok, false);
  assert.deepEqual(result.structuredContent.diagnostics.map((d: any) => [d.code, d.path, d.hint]), [["unknown-key", "/states/s/sett", 'Did you mean "set"?']]);
});

test("simulate returns a summary; a broken file is a tool error with fixes", async () => {
  const ok = await call("nudg_simulate", { file: "examples/like.nudg.json", events: [{ event: "heart.tap", t: "100ms" }] });
  assert.ok(ok.structuredContent.summary["heart.scale"].max > 1.2);
  const broken = await call("nudg_simulate", { source: '{"nudg":"0.1","targets":["a"],"values":{"a.x":0},"initial":"z","states":{"s":{}}}' });
  assert.equal(broken.isError, true);
  assert.match(broken.content[0].text, /unknown-state at \/initial/);
  const missing = await call("nudg_simulate", { file: "nope.nudg.json" });
  assert.equal(missing.isError, true);
});

test("simulate accepts a whole drag as one item", async () => {
  const result = await call("nudg_simulate", { file: "examples/toggle-drag.nudg.json", events: [{ drag: "track", t: 0.1, until: 0.18, dx: 9 }] });
  assert.equal(result.isError, undefined, result.content[0].text);
  assert.equal(result.structuredContent.samples.at(-1).state[0], "on");
  const bad = await call("nudg_simulate", { file: "examples/toggle-drag.nudg.json", events: [{ drag: "track", t: 0.3, until: 0.1 }] });
  assert.equal(bad.isError, true);
});

test("compare returns a verdict and a picture", { skip: chrome ? false : "no Chrome found" }, async () => {
  const base = JSON.parse(readFileSync(`${root}examples/toggle.nudg.json`, "utf8"));
  const b = JSON.parse(JSON.stringify(base));
  b.animate["knob.x"].spring.bounce = 0.5;
  const result = await call("nudg_compare", { a: { file: "examples/toggle.nudg.json" }, b: { source: JSON.stringify(b) }, events: [{ event: "track.tap", t: 0.05 }], labels: ["now", "bouncier"] });
  assert.equal(result.isError, undefined, result.content[0].text);
  assert.match(result.content[0].text, /clear change/);
  assert.equal(result.structuredContent.verdict, "clear");
  assert.ok(result.content.some((c: any) => c.type === "image"));
  const bouncier = `${root}examples/toggle-bouncier.tmp.nudg.json`;
  writeFileSync(bouncier, JSON.stringify(b));
  try {
    const strip = await call("nudg_compare", { a: { file: "examples/toggle.nudg.json" }, b: { file: "examples/toggle-bouncier.tmp.nudg.json" }, html: "examples/toggle.html", events: [{ event: "track.tap", t: 0.05 }], at: [0, 0.3] });
    assert.equal(strip.isError, undefined, strip.content[0].text);
    assert.equal(strip.structuredContent.opened, false, "tests never open the person's browser");
    assert.ok(strip.content.some((c: any) => c.type === "image"), "a filmstrip with both rows");
  } finally {
    rmSync(bouncier, { force: true });
  }
});

test("compare with before: the file at a git revision against the file on disk, no copy", async () => {
  const result = await call("nudg_compare", { file: "examples/toggle.nudg.json", before: "HEAD", events: [{ event: "track.tap", t: 0.05 }] });
  assert.equal(result.isError, undefined, result.content[0].text);
  assert.match(result.content[0].text, /^HEAD: examples\/toggle\.nudg\.json @ HEAD  now: examples\/toggle\.nudg\.json/, "labels and names a person can read, not temp paths");
  assert.match(result.content[0].text, /behave identically/);
  // Identical versions with a page requested: nothing is rendered or opened.
  const same = await call("nudg_compare", { file: "examples/toggle.nudg.json", before: "HEAD", html: "examples/toggle.html", events: [{ event: "track.tap", t: 0.05 }] });
  assert.equal(same.isError, undefined, same.content[0].text);
  assert.match(same.content[0].text, /No page was opened: the two versions behave identically/);
  assert.ok(!same.content.some((c: any) => c.type === "image"));
  // rev on one side only labels that side.
  const onB = await call("nudg_compare", { a: { file: "examples/toggle-press.nudg.json" }, b: { file: "examples/toggle.nudg.json", rev: "HEAD" }, events: [{ event: "track.tap", t: 0.05 }] });
  assert.match(onB.content[0].text, /^A: examples\/toggle-press\.nudg\.json  HEAD: examples\/toggle\.nudg\.json @ HEAD/);
  const both = await call("nudg_compare", { file: "examples/toggle.nudg.json", before: "HEAD", a: { file: "x" }, events: [] });
  assert.equal(both.isError, true);
  assert.match(both.content[0].text, /not both/);
  const bad = await call("nudg_compare", { file: "examples/toggle.nudg.json", before: "nope", events: [] });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /No revision "nope"/);
});

test("compare from a running page: url snapshots the component and writes the page without opening it", { skip: chrome ? false : "no Chrome found" }, async () => {
  const base = JSON.parse(readFileSync(`${root}examples/toggle.nudg.json`, "utf8"));
  base.animate["knob.x"].spring.bounce = 0.7;
  const bouncier = `${root}examples/toggle-bouncier.tmp.nudg.json`;
  writeFileSync(bouncier, JSON.stringify(base));
  let result;
  try {
    result = await call("nudg_compare", { a: { file: "examples/toggle.nudg.json" }, b: { file: "examples/toggle-bouncier.tmp.nudg.json" }, url: "examples/toggle.html", events: [{ event: "track.tap", t: 0.05 }], open: false, at: [0, 0.3] });
  } finally {
    rmSync(bouncier, { force: true });
  }
  assert.equal(result.isError, undefined, result.content[0].text);
  assert.match(result.content[0].text, /Snapshot of \[data-nudg="track"\] from examples\/toggle\.html: 2 elements/);
  assert.match(result.content[0].text, /For the person: open/);
  assert.equal(result.structuredContent.opened, false);
  assert.ok(String(result.structuredContent.page).endsWith(".html"));
  assert.ok(result.content.some((c: any) => c.type === "image"));
});

test("observe judges the real page against the file", { skip: chrome ? false : "no Chrome found" }, async () => {
  const result = await call("nudg_observe", { url: "test/fixtures/host/unmount.html", selector: "#btn", file: "examples/button-press.nudg.json", actions: [{ action: "tap", t: 0.1 }], settle: 0.5 });
  assert.equal(result.isError, undefined, result.content[0].text);
  assert.match(result.content[0].text, /left the page at 0\.\d+s/);
  assert.equal(result.structuredContent.judgement.verdict, "never-shown");
  const bad = await call("nudg_observe", { url: "test/fixtures/host/unmount.html", selector: "#btn", actions: [{ action: "poke", t: 0.1 }] });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /Unknown action "poke"/);
});

test("critique names what to fix and where it comes from", async () => {
  const file = `${root}examples/unpausable-toast.tmp.nudg.json`;
  const doc = JSON.parse(readFileSync(`${root}examples/toast.nudg.json`, "utf8"));
  doc.states.shown.when["after:3s"] = "hidden";
  writeFileSync(file, JSON.stringify(doc));
  let result;
  try {
    result = await call("nudg_critique", { file: "examples/unpausable-toast.tmp.nudg.json" });
  } finally {
    rmSync(file, { force: true });
  }
  assert.equal(result.isError, undefined, result.content[0].text);
  assert.match(result.content[0].text, /suggestion short-timeout at \/states\/shown\/when\/after:3s/);
  assert.match(result.content[0].text, /from: WCAG/);
  assert.equal(result.structuredContent.findings[0].code, "short-timeout");
});

test("plot returns an image", { skip: chrome ? false : "no Chrome found" }, async () => {
  const result = await call("nudg_plot", { file: "examples/toggle.nudg.json", events: [{ event: "track.tap", t: 0.1 }] });
  const image = result.content.find((c: any) => c.type === "image");
  assert.equal(image.mimeType, "image/png");
  assert.equal(Buffer.from(image.data, "base64").subarray(1, 4).toString(), "PNG");
});

test("render returns a filmstrip", { skip: chrome ? false : "no Chrome found" }, async () => {
  const result = await call("nudg_render", { file: "examples/like.nudg.json", html: "examples/like.html", events: [{ event: "heart.tap", t: 0 }], at: [0, 0.1] });
  assert.equal(result.isError, undefined, result.content[0].text);
  assert.deepEqual(result.structuredContent.frames.map((f: any) => f.t), [0, 0.1]);
  assert.ok(result.content.some((c: any) => c.type === "image"));
});
