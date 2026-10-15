// The "before" of a comparison, from git: a file and the files it imports, as they were
// at a revision, written to a folder with the same relative layout so every tool can
// read them like any other files. No copy to make, no second file to keep around.

import { execFileSync } from "node:child_process";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

/**
 * Writes `file` as it was at `rev` (HEAD, HEAD~1, a branch, a tag, a commit) into `dir`,
 * with its imports, and returns the written file's path. Throws with a plain message
 * when there is no repository, no such revision, or no such file at that revision.
 */
export function materializeRevision(file: string, rev: string, dir: string): string {
  // Real paths on both sides: git reports the repository root with symlinks resolved
  // (/private/var on macOS). The file itself may not exist on disk any more.
  const abs = join(realpathSync(dirname(resolve(file))), basename(file));
  const root = realpathSync(repoRoot(dirname(abs)));
  const rel = relative(root, abs).split(sep).join("/");
  if (rel.startsWith("..")) throw new Error(`${file} is outside the git repository at ${root}.`);
  const written = new Set<string>();
  const visit = (relPath: string, text: string) => {
    const target = join(dir, relPath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
    written.add(relPath);
    let doc: { import?: unknown };
    try {
      doc = JSON.parse(text);
    } catch {
      return;
    }
    for (const spec of Array.isArray(doc.import) ? doc.import : []) {
      if (typeof spec !== "string") continue;
      const importRel = relative(root, resolve(root, dirname(relPath), spec)).split(sep).join("/");
      if (written.has(importRel) || importRel.startsWith("..")) continue;
      const imported = show(root, rev, importRel);
      if (imported !== undefined) visit(importRel, imported);
      // A missing import at that revision is the compiler's to report.
    }
  };
  const text = show(root, rev, rel);
  if (text === undefined) throw new Error(`${rel} does not exist at ${rev}${rev === "HEAD" ? " (is it committed?)" : ""}.`);
  visit(rel, text);
  return join(dir, rel);
}

function repoRoot(from: string): string {
  try {
    return execFileSync("git", ["-C", from, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    throw new Error(`${from} is not inside a git repository, so there is no revision to compare against.`);
  }
}

function show(root: string, rev: string, rel: string): string | undefined {
  try {
    return execFileSync("git", ["-C", root, "show", `${rev}:${rel}`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    const message = String((e as { stderr?: string }).stderr ?? "");
    if (/invalid object name|unknown revision|bad revision/i.test(message)) throw new Error(`No revision ${JSON.stringify(rev)} in this repository.`);
    return undefined;
  }
}
