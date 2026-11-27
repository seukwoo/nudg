// The one-time GitHub star line: shown only to a person at a terminal, once, and never to agents or CI.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { shouldShowStar, type StarCheck } from "../src/node/star.ts";

const base: StarCheck = { code: 0, command: "validate", json: false, isTTY: true, env: {}, seen: false };

test("the star line shows for a successful terminal command the first time", () => {
  assert.equal(shouldShowStar(base), true);
});

test("the star line never shows to agents, CI, piped output, failures, or once seen", () => {
  assert.equal(shouldShowStar({ ...base, seen: true }), false);
  assert.equal(shouldShowStar({ ...base, code: 1 }), false);
  assert.equal(shouldShowStar({ ...base, json: true }), false);
  assert.equal(shouldShowStar({ ...base, isTTY: false }), false);
  assert.equal(shouldShowStar({ ...base, command: "mcp" }), false);
  assert.equal(shouldShowStar({ ...base, env: { CI: "true" } }), false);
  assert.equal(shouldShowStar({ ...base, env: { NUDG_NO_STAR: "1" } }), false);
  assert.equal(shouldShowStar({ ...base, env: { CI: "false" } }), true);
});

test("a piped CLI run prints no star line and leaves no marker", () => {
  const dir = mkdtempSync(join(tmpdir(), "nudg-star-"));
  const marker = join(dir, "star-shown");
  try {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const out = execFileSync(process.execPath, [join(root, "src/cli.ts"), "validate", "examples/toggle.nudg.json"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NUDG_LOG: "off", NUDG_STAR_MARKER: marker, CI: "" },
    });
    assert.doesNotMatch(out, /⭐/);
    assert.equal(existsSync(marker), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
