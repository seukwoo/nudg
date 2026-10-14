// Talks to `nudg mcp` over stdio the way an MCP client does.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
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
  server = spawn(process.execPath, [`${root}src/cli.ts`, "mcp"], { cwd: root, stdio: ["pipe", "pipe", "inherit"] });
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
    ["nudg_guide", "nudg_validate", "nudg_simulate", "nudg_plot", "nudg_compare", "nudg_render"],
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
  const strip = await call("nudg_compare", { a: { file: "examples/toggle.nudg.json" }, b: { file: "examples/toggle-press.nudg.json" }, html: "examples/toggle.html", events: [{ event: "track.tap", t: 0.05 }], at: [0, 0.3] });
  assert.equal(strip.isError, undefined, strip.content[0].text);
  assert.ok(strip.content.some((c: any) => c.type === "image"), "a filmstrip with both rows");
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
