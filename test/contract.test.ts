// `nudg generate`: the names a host may use, as a TypeScript module, and the stale check.
// The compile-time side (misspelled names fail) is test/fixtures/contract-types.ts, run by `npm run typecheck`.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { contract, contractModule, contractName } from "../src/core/contract.ts";
import { compilePath } from "../src/node/load.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const cli = (...args: string[]) => spawnSync(process.execPath, [`${root}src/cli.ts`, ...args], { encoding: "utf8" });

test("contract: targets, handled events, read inputs and every state path, regions included", () => {
  const c = contract(compilePath(`${root}examples/video-player.nudg.json`).program!);
  assert.ok(c.targets.includes("progress"));
  assert.ok(c.events.includes("host.play") && c.events.includes("controls.hoverstart"));
  assert.ok(c.events.includes("host.scrub-start"), "timer pause reasons are events too");
  assert.deepEqual(c.inputs, ["host.buffered", "host.progress", "host.volume"]);
  assert.ok(c.states.includes("playback/paused") && c.states.includes("control-visibility/hidden"));

  const drag = contract(compilePath(`${root}examples/toggle-drag.nudg.json`).program!);
  assert.deepEqual(drag.inputs, ["track.drag.x"], "layout measurements are the adapter's, not the host's");
  assert.deepEqual(drag.states, ["off", "on", "dragging"]);
});

test("contract: a declared host is the list of app names", () => {
  const c = contract(compilePath(`${root}examples/microphone.nudg.json`).program!);
  assert.deepEqual(c.inputs, ["host.volume"]);
  assert.deepEqual(c.events.filter((e) => e.startsWith("host.")), ["host.connect", "host.connected", "host.failed", "host.leave", "host.mute", "host.unmute"]);
});

test("contract: names and the module text are stable", () => {
  assert.equal(contractName("examples/toggle-drag.nudg.json"), "ToggleDragContract");
  assert.equal(contractName("3d card.json"), "Nudg3dCardContract");
  const text = contractModule({ targets: ["a"], events: [], inputs: [], states: ["x/y"] }, "dir/a.nudg.json");
  assert.match(text, /export interface AContract \{\n  targets: "a";\n  events: never;\n  inputs: never;\n  states: "x\/y";\n\}/);
  assert.match(text, /from a\.nudg\.json; do not edit/);
});

test("cli generate writes beside the file, and --check fails on missing, stale and broken files", () => {
  const dir = mkdtempSync(join(tmpdir(), "nudg-generate-"));
  try {
    const file = join(dir, "toggle.nudg.json");
    const out = join(dir, "toggle.nudg.ts");
    copyFileSync(`${root}examples/toggle-drag.nudg.json`, file);

    let r = cli("generate", file, "--check", "--json");
    assert.equal(r.status, 1);
    assert.equal(JSON.parse(r.stdout).results[0].status, "missing");
    assert.equal(existsSync(out), false, "--check writes nothing");

    assert.equal(cli("generate", file).status, 0);
    assert.match(readFileSync(out, "utf8"), /export interface ToggleContract/);
    r = cli("generate", file, "--check");
    assert.equal(r.status, 0);
    assert.match(r.stdout, /unchanged/);

    // Only a change to the names makes it stale; reformatting the file does not.
    writeFileSync(file, JSON.stringify(JSON.parse(readFileSync(file, "utf8"))));
    assert.equal(cli("generate", file, "--check").status, 0);
    writeFileSync(file, readFileSync(file, "utf8").replace('"host.check"', '"host.on"'));
    r = cli("generate", file, "--check");
    assert.equal(r.status, 1);
    assert.match(r.stdout, /stale, run `nudg generate/);

    writeFileSync(file, '{ "nudg": "0.2", "targets": [] }');
    r = cli("generate", file);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /can't generate, the file has errors/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
