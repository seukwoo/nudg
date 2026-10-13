// Needs a local Chrome; skipped without one.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { findChrome } from "../src/node/chrome.ts";
import { renderFrames } from "../src/node/render.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const chrome = findChrome();

test("render captures real frames as one PNG", { skip: chrome ? false : "no Chrome found" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "nudg-test-"));
  try {
    const out = join(dir, "like.png");
    const result = await renderFrames({
      file: `${root}examples/like.nudg.json`,
      html: `${root}examples/like.html`,
      events: [{ t: 0.05, event: "heart.tap" }],
      times: [0, 0.1, 0.3],
      out,
      chrome: chrome!,
    });
    assert.ok(existsSync(out));
    assert.deepEqual(readFileSync(out).subarray(1, 4).toString(), "PNG");
    assert.deepEqual(result.frames.map((f) => f.state), [["idle"], ["liked"], ["liked"]]);
    assert.deepEqual(result.unbound, []);
    assert.deepEqual(result.unknown, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
