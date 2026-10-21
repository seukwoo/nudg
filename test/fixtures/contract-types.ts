// Type-level checks for generated contracts, run by `npm run typecheck` (never executed).
// Each @ts-expect-error must be an error, so a misspelled name stops compiling.

import { createPlayer } from "../../src/core/player.ts";
import type { Program } from "../../src/core/types.ts";
import { play } from "../../src/dom/play.ts";
import { useNudg } from "../../src/react/index.ts";

interface ToggleContract {
  targets: "knob" | "track";
  events: "host.check" | "track.tap";
  inputs: "host.level";
  states: "off" | "on" | "panel/hidden";
}

declare const program: Program;

export function Component() {
  const nudg = useNudg<ToggleContract>(program, { state: ["on"], exit: "hidden" });
  nudg.bind("knob");
  nudg.send("host.check");
  nudg.input("host.level", 0.5);
  const on: boolean = nudg.state.includes("on");
  // @ts-expect-error a misspelled target
  nudg.bind("nob");
  // @ts-expect-error an event the file doesn't handle
  nudg.send("host.chek");
  // @ts-expect-error an input the file doesn't read
  nudg.input("host.levle", 1);
  // @ts-expect-error a state that doesn't exist
  useNudg<ToggleContract>(program, { state: ["of"] });
  // @ts-expect-error an exit state that doesn't exist
  useNudg<ToggleContract>(program, { exit: "hiden" });

  // Without a contract, any string still works.
  useNudg(program).send("anything");
  return on;
}

export function players(root: ParentNode) {
  const dom = play<ToggleContract>(program, root);
  dom.send("track.tap");
  // @ts-expect-error a misspelled target
  dom.bind("trak", document.body);
  const headless = createPlayer<ToggleContract>(program, { host: { now: () => 0, frame: () => () => {} } });
  // @ts-expect-error an input the file doesn't read
  headless.input("track.drag.x", 1);
}
