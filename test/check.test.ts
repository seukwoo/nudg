import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkDir } from "../src/node/check.ts";

const slow = (keep?: string[]) =>
  JSON.stringify({
    nudg: "1.7",
    ...(keep ? { keep, note: "The ceremony is long on purpose." } : {}),
    targets: ["card"],
    values: { "card.y": 40 },
    animate: { "card.y": { tween: { duration: 1.2, ease: "out" } } },
    initial: "hidden",
    when: { "host.show": "shown" },
    states: { hidden: {}, shown: { set: { "card.y": 0 } } },
  });

function project(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "nudg-check-"));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

test("check sends what has one right answer to the AI, and what is a choice to the person", () => {
  const dir = project({
    "card.nudg.json": slow(),
    "broken.nudg.json": '{ "nudg": "1.7", "targets": ["a"], "values": { "a.wobble": 1 }, "initial": "s", "states": { "s": {} } }',
    "app.css": "@keyframes rise { from { transform: translateY(8px) } to { transform: none } }",
  });
  try {
    const c = checkDir(dir);
    assert.equal(c.files, 2);
    assert.deepEqual(c.forPerson.map((i) => `${i.file} ${i.code}`), ["card.nudg.json slow-transition"]);
    assert.deepEqual(c.forAi.map((i) => `${i.kind} ${i.file} ${i.code}`), ["error broken.nudg.json unknown-property", "outside app.css css-keyframes"]);
    assert.match(c.headline, /^2 nudg files, \d+ transitions, \d+% of the app's motion on nudg\. 1 needs you: card\.nudg\.json: /);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check doesn't raise what a file keeps, and says nothing needs the person when all is well", () => {
  const dir = project({ "card.nudg.json": slow(["slow-transition"]) });
  try {
    const c = checkDir(dir);
    assert.deepEqual(c.forPerson, []);
    assert.deepEqual(c.forAi, []);
    assert.equal(c.kept, 1);
    assert.equal(c.headline, "1 nudg file, 2 transitions, 100% of the app's motion on nudg. Nothing needs you.");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
