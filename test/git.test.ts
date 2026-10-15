// The "before" from git: a file and its imports as they were at a revision.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { materializeRevision } from "../src/node/git.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const git = (dir: string, ...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** A throwaway repository with a committed file that imports a motion library, then an edit on disk. */
function scratchRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudg-git-"));
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "t");
  mkdirSync(join(dir, "ui", "motion"), { recursive: true });
  writeFileSync(join(dir, "ui", "motion", "brand.nudg.json"), readFileSync(join(root, "examples", "motion", "brand.nudg.json")));
  writeFileSync(join(dir, "ui", "like.nudg.json"), readFileSync(join(root, "examples", "like.nudg.json"), "utf8").replace('"./motion/brand.nudg.json"', '"./motion/brand.nudg.json"'));
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "before");
  // The edit on disk is in the imported motion library: a much bigger, slower pop. The
  // file itself is unchanged, so the comparison only differs if imports come from the revision.
  const brand = join(dir, "ui", "motion", "brand.nudg.json");
  const text = readFileSync(brand, "utf8");
  const edited = text.replace('"pop": { "kick": 6, "spring": { "duration": 0.4, "bounce": 0.5 } }', '"pop": { "kick": 30, "spring": { "duration": 1.2, "bounce": 0.8 } }');
  if (edited === text) throw new Error("the brand fixture's pop changed; update the edit");
  writeFileSync(brand, edited);
  return dir;
}

test("materializeRevision writes the file and its imports as they were at the revision", () => {
  const dir = scratchRepo();
  const out = mkdtempSync(join(tmpdir(), "nudg-before-"));
  try {
    const file = materializeRevision(join(dir, "ui", "like.nudg.json"), "HEAD", out);
    assert.equal(file, join(out, "ui", "like.nudg.json"));
    assert.ok(existsSync(join(out, "ui", "motion", "brand.nudg.json")), "the import came along");
    assert.ok(readFileSync(join(out, "ui", "motion", "brand.nudg.json"), "utf8").includes('"kick": 6,'), "the committed import, not the edit");
    assert.throws(() => materializeRevision(join(dir, "ui", "like.nudg.json"), "nope", out), /No revision "nope"/);
    assert.throws(() => materializeRevision(join(dir, "ui", "new.nudg.json"), "HEAD", out), /does not exist at HEAD \(is it committed\?\)/);
    assert.throws(() => materializeRevision(join(tmpdir(), "x.nudg.json"), "HEAD", out), /not inside a git repository|does not exist at HEAD|outside the git repository/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});

test("nudg compare --before HEAD compares the edit on disk with the committed version", () => {
  const dir = scratchRepo();
  try {
    const stdout = execFileSync(process.execPath, [join(root, "src/cli.ts"), "compare", "ui/like.nudg.json", "--before", "HEAD", "--send", "heart.tap@0.05", "--json"], { cwd: dir, encoding: "utf8" });
    const result = JSON.parse(stdout);
    assert.equal(result.verdict, "clear", result.headline);
    assert.match(result.headline, /heart\.scale/);
    const text = execFileSync(process.execPath, [join(root, "src/cli.ts"), "compare", "ui/like.nudg.json", "--before", "HEAD", "--send", "heart.tap@0.05"], { cwd: dir, encoding: "utf8" });
    assert.match(text, /A clear change/);
    assert.throws(
      () => execFileSync(process.execPath, [join(root, "src/cli.ts"), "compare", "ui/like.nudg.json", "--before", "nope", "--send", "heart.tap@0.05"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
      (e: { status: number; stderr: string }) => e.status === 2 && /No revision "nope"/.test(e.stderr),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
