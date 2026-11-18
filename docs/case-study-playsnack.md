# Case study: moving PlaySnack's motion onto nudg

[PlaySnack](https://playsnack.app) is a web app of party games and quizzes, built mostly by AI coding agents. Its motion had grown the way motion grows in such an app: CSS `@keyframes` in template strings, transitions on shared classes, a document listener for presses, timers to stagger cards and to unmount a toast. In November 2026 one agent moved it onto nudg in a single pull request ([playsnack#1054](https://github.com/playsnack/playsnack/pull/1054)), using nudg 1.12.0.

## The result

| | Before | After |
|---|---|---|
| Motion on nudg (`nudg audit`) | **49%** (52 on nudg, 55 outside) | **89%** (127 on nudg, 16 outside) |
| CSS `@keyframes` converted | | **36 of 42**, each proven to move as before |
| App tests | | 1410 of 1410 pass |

The 16 left outside are listed by the audit:
- **Out of scope for this pass (6):** golf keyframes.
- **Kept on CSS (6):** the side menu's keyframes and transitions, shared with a static page that runs no JavaScript.
- **Things nudg couldn't do yet (4):** each one filed as an issue:
  - a staggered pop ([#161](https://github.com/seukwoo/nudg/issues/161));
  - hover tints from theme variables ([#162](https://github.com/seukwoo/nudg/issues/162));
  - hand-designed confetti paths ([#163](https://github.com/seukwoo/nudg/issues/163)).

## How it went

**1. Measure.** `npx @nudg/core audit snack-player/src` lists every piece of motion outside nudg, with what in nudg replaces it. Its first line is the share on nudg: 49%.

**2. Convert the keyframes, with proof.** For each `@keyframes` the audit names the exact command:

```sh
npx @nudg/core from-css snack-player/src/Ceremony.tsx snkRoll --exact --out motion/Ceremony-snkRoll.nudg.json
```

`from-css` reads the keyframes and the `animation` line that plays them, writes a nudg file, then plays both and compares them at 60 points and two element sizes. It writes the file only when they agree within 0.5 px, 0.5° and 0.01.
- **Values only the app knows.** Some keyframes used values only the app knows (`${GO_MS}`, `${V.accent}`); `--set` supplies them.
- **A conversion it refused.** One keyframe animation rotated after a non-uniform scale, which skews a corner by 1.6 px. nudg draws no skew, so `from-css` refused it and said how to change the CSS. With `rotate` moved before `scale` in each frame, it converted.
- **Springs offered.** Nine keyframes overshoot like a spring. For each, `from-css` offered a fitted spring beside the exact file. The owner wanted the exaggerated effects to feel identical, so the agent kept them exact for now.

**3. Replace the glue.**
- The press listener became `playEach(press, selector)`.
- The card stagger became one file with a delay read from the card's index (`"delay": { "input": "host.index" }`).
- The toast's fade and unmount timer became a file with an exit state.

**4. Check against the old app, frame by frame.** The agent rendered the old CSS and the new nudg side by side under a frozen clock. Every scene's mean pixel difference per frame was 3.8 or less, except one frame of a medal's rays (9.4, one frame of rounding).

## What nudg learned

The migration found one bug and three gaps. All four are now fixed or designed:

- **A converter's proof is only as independent as its inputs.**
  - The bug: `from-css` read `--animation "fadeIn .4s ease .65s"` with the delay and the duration swapped. Its own proof passed anyway, because the proof plays the CSS at the same timing the tool read. The frame comparison caught it: a flash waited 0.3 s.
  - The fix: the times are now read as CSS reads them, and the report starts with the timing it read, so a person or agent can see it ([#165](https://github.com/seukwoo/nudg/pull/165), [devlog](devlog.md#2026-11-13-a-proof-that-shares-its-input-cant-catch-a-misread-input)).
- **An entry effect couldn't wait.** A tag that pops in after its card needs a kick that waits for the card's delay. Designed as format 1.7 ([design](design.md#proposal-an-entry-effect-can-wait-format-17-161)).
- **Theme colors.** Tints that switch with light and dark live in CSS variables. Designed as colors the app names (`host.colors`), read from CSS variables on the web ([design](design.md#proposal-colors-the-app-names-162)).
- **Designed confetti.** A burst whose pieces follow an authored arc, not physics. Designed as emitter paths ([design](design.md#proposal-confetti-with-designed-paths-163)).
- **Pages without JavaScript.** The side menu stayed on CSS because a static page shares it. Designed as `nudg to-css`, which writes CSS from the same file ([design](design.md#proposal-nudg-to-the-web-without-nudg-nudg-to-css)).

Along the way, the conversions themselves pushed nudg forward:
- format 1.5 lets keyframe values be shares of the element's size (`translateX(-100%)`) and gives each frame its own ease;
- `from-css` learned transform lists in any order;
- format 1.6 added a shadow's spread and an inner shadow, so a ring that spreads and an outline that flashes are in the file.

## Do it on your app

```sh
npx @nudg/core audit src                               # the share, and what replaces each piece
npx @nudg/core from-css src/Card.tsx cardIn --out card-in.nudg.json   # per @keyframes the audit lists
```

With an AI agent, add the MCP server (`claude mcp add nudg -- npx -y @nudg/core mcp`) and ask it to move the app's motion onto nudg. It calls `nudg_audit` and `nudg_from_css` itself, and asks you only when it offers a spring.
