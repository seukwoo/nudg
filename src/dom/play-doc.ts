// playDoc: compile and play in one call. Kept apart from play.ts so a page that plays a
// compiled program (nudg to-css --script) loads the player without the compiler.

import { toProgram } from "../core/to-program.ts";
import { play, type Player, type PlayOptions } from "./play.ts";
import type { NudgContract } from "../core/types.ts";

/**
 * Compiles a document (a preset, or a parsed .nudg.json) and plays it, in one call:
 * `playDoc(presets.press(), button)`. When `root` is an element and no [data-nudg] on or
 * in it names one of the document's targets, it is bound to the document's first target. Throws if the document has errors.
 */
export function playDoc<C extends NudgContract = NudgContract>(doc: object, root: ParentNode | null = document, options: PlayOptions<C> & { files?: Record<string, unknown> } = {}): Player<C> {
  const program = toProgram(doc, options.files);
  // Parts that belong to another player (a switch's knob inside a pressed row) don't count.
  const bare = root instanceof Element && ![root, ...root.querySelectorAll("[data-nudg]")].some((el) => program.targets.includes(el.getAttribute("data-nudg") ?? ""));
  const { files: _files, ...rest } = options;
  return play(program, bare ? null : root, bare ? { ...rest, bind: { [program.targets[0]]: root, ...rest.bind } } : rest);
}
