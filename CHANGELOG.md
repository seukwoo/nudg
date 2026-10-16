# Changelog

## Unreleased

- **Format 0.4: layout as input.** `{ "measure": "tab2.x" }` / `{ "measure": "panel.naturalHeight" }` in `values` and `set`. The host reports each target's box and natural size as `target.layout.*` inputs; positions align (the translation onto the measured box), sizes are the size; the first report places, later reports move with the property's motion. The DOM adapter measures (offsets, scroll size) and re-measures on resize, font load and late binding. `--layout` / `layout` for `simulate`, `plot` and `compare`, with a note listing missing measurements. New `tabs` example; `accordion` opens to its content. Schema 0.4, conformance `layout-*` and `validation-0.4`.
- **`nudg log --share`** prints exactly what it would share (counts only: rounds per change, verdicts, tool calls, versions; no file names, paths, URLs or code) and opens a prefilled GitHub issue to read and submit. The skill may offer it once at the end of a round of work.
- **`nudg log --share`** prints exactly what it would share (counts only: rounds per change, verdicts, tool calls, versions; no file names, paths, URLs or code) and opens a prefilled GitHub issue to read and submit. nudg recommends it: `nudg log` ends with it, the CLI suggests it at most once a week once three changes have been judged, the MCP instructions and the skill have the agent recommend it once when a round of work is done, and the README and CONTRIBUTING ask for it.
- **`nudg log --share [--note "..."]`** prints exactly what it would share (counts only: rounds per change, verdicts, tool calls, versions; no file names, paths, URLs or code) and opens a prefilled GitHub issue to read and submit. **When a change reaches three rounds**, the CLI asks right then, and over MCP the compare result tells the agent to ask the person once; if they agree, the new `nudg_share` tool returns the link with their note for them to submit. Otherwise the CLI suggests sharing at most once a week; README and CONTRIBUTING ask for it.
- **A local judge log.** Every `compare`, `observe` and `validate` (CLI and MCP) appends a line to `~/.nudg/log.jsonl`; `nudg log` summarizes it, above all rounds per change (the same file compared again within 15 minutes) and rounds that showed nothing anyone could see. It never leaves the machine; `NUDG_LOG=off` turns it off, `NUDG_LOG=<file>` moves it.
- **`nudg skill`** installs a Claude Code skill (`/nudg`) that teaches the agent the say, see, judge loop, for the project or (`--user`) every project.

## 0.6.0

The judge loop in one call from a real app: compare against the running page and against git. Format stays 0.3.

- **Review fixes for the two features below** (each reproduced first): the MCP page opens once per server session instead of a new tab per call, identical versions open nothing, labels and names are readable (`file @ HEAD`, never a temp path), the result says which side is which from the labels, `open` must be `true`/`false`, pages live in a per-session folder so sessions don't overwrite each other, materialized revisions are removed after use, `before` with `a`/`b` is an error, snapshot targets come from both versions, the filmstrip harness serves a materialized revision's imports, nested imports play on the compare page, the compare page shows a compile error on its stage instead of staying blank, a down dev server is named instead of "targets not on the page", and the test suite never opens a browser. Snapshot: body-wide targets get a wrapper instead of a `<body>` that merged into the compare page, a positioned target brings its container, shadow roots become declarative templates with their styles inlined, a local page's resources resolve from the file, and notes report state-dependent rules, `<use>` references outside the element, and targets outside the chosen element. Git: a moved folder gets a real message; `--before` without a value is an error.
- **The "before" from git.** `nudg compare <file> --before HEAD` (or any revision) and `nudg_compare` with `file` + `before`, or `{ file, rev }` on either side: the old version and its imports are read from the repository, so there is no copy to make or clean up. Labels default to the revision and "now".
- **Compare from the running app.** `nudg compare --url <app> [--select css] [--open]` and `nudg_compare` with `url` / `selector` / `open`: the component is snapshotted from the page (the smallest element holding every bound target, computed styles inlined, scripts dropped), the filmstrip and the side-by-side page are made from that snapshot, and the page opens in the person's browser (MCP default; `NUDG_OPEN=false` turns it off). The report says what the snapshot couldn't carry. The DOM adapter now marks every bound element with `data-nudg`, so targets bound by ref (React) are found too. `openInBrowser` and `snapshotElement` from `@nudg/core/node`.

## 0.5.1

Fixes from a review of the judge tools (every item reproduced before it was fixed):

- **observe:** 3D transforms (`matrix3d`, from `translateZ` and the like) were read as identity, so such elements measured as never moving. Actions now go to the first target that handles them (a toggle's track), with `--on` / `on` to override; the measured element stays the first animated target. A page still moving after the file came to rest is no longer "played"; an element that leaves after its motion settled is no longer "never shown"; a target nothing of which can be measured is **unmeasured** instead of "played". The page's own exceptions are reported first. A page that navigates away during an action says so. All of the format's key names work in `key:<name>`. Exit codes: 0 played, 1 not played, 2 couldn't observe. Overshoot legs are cut at an action only when the value was at rest there.
- **compare:** `--out x.html` without `--html` is an error instead of an SVG with the wrong extension; a `</script>` inside a note no longer breaks the page; "press both" presses the first target the file lets you press; a clone without a build is told the page loads the runtime from unpkg. `nudg_compare` says that `html` needs both versions as files.
- **Chrome:** a Chrome path that can't be started rejects with a message instead of crashing the process.
- **Adapter:** a destroyed player ignores late `send`/`input` calls (a hook's timer firing after a remount).
- **Site:** the compare session keeps one timeline across edits and speed changes (a second tap no longer collapses onto the first); switching the example clears it; app timers in hooks follow the player's speed and die with the player; the last 10 s of interaction are simulated instead of dropping events after 10 s; the tools row wraps on phones; the verdict is announced to assistive tech.
- **Exports:** `comparePage`, `readWithImports`, `checkAction` from `@nudg/core/node`; `actionTarget`, `handledEvents` from `@nudg/core`.

## 0.5.0

Adapters only; the format stays 0.3.

- **Exits (presence).** The DOM adapter takes `{ exit: "hidden", onExit }` and exposes `player.present()`; `useNudg` takes the same options and returns `present`. Once the machine has entered an exit state from elsewhere and every value has come to rest, `present` turns false and `onExit` fires once: that is when to remove the element, so the exit motion is seen instead of cut off by an unmount (the case `nudg observe` reports as "never shown"). The toast example's host page uses it.
- **Live A/B in the playground.** "Compare with original" plays the example beside the edit on the same markup; interacting with either stage sends the same events to both, a speed select gives ¼× and ⅒× slow motion, and the perceptibility verdict (core `compare`, in the browser) updates after each interaction and each edit. "Compare in playground" on every example page opens it. The DOM adapter gained `onEvent` (events and inputs the adapter produced from the DOM, for mirroring or recording), `speed` (a time scale for the real-time clock, timers included) and `player.now()`; `@nudg/core` exports `compare`.

## 0.4.0

The package moves to 0.4 for two new judge tools; the format stays 0.3 (`"nudg": "0.3"`), and the v0.4 grammar (layout measurement, decay) is still ahead.

- **`nudg observe` / `nudg_observe`: host truth.** Opens the real page in headless Chrome with its scripts running, performs actions (`tap`, `down`, `up`, `hover`, `leave`, `key:<name>`), measures the element every frame (translate, scale, rotation, opacity, size, presence through shadow roots), and reports what the page showed. With a file it judges the page under the same actions at the times they happened: played, differs, never shown (unmounted mid-motion), or nothing moved. The DOM adapter is not involved: it measures any page, however the motion is made.
- **Overshoot is measured per target leg.** The simulator reports `overshoot` per property as how far the value went past wherever it was heading at the time, so a press that goes 0 → 6 → 0 without bouncing reports 0 (it used to report the whole excursion); `compare` uses it. The runtime exposes `targets()`.
- **`nudg compare --out compare.html`: a page that plays A and B side by side**, on the real markup, with the same events, looping, with live values, replay, press-both with a chosen hold, 1× / ¼× / ⅒× speed and pause. The runtime is inlined, so the file works offline. `nudg_compare` writes it next to the filmstrip whenever `html` is given and tells the person to open it. Stills can't show motion; this can.
- **Compare filmstrips show the moments that matter:** where each property differs most, each event and 80 ms after it, captioned and outlined, on top of the evenly spaced frames.
- **Plot** marks sub-pixel overshoot as `(<1px)`.
- **Guide:** feel words (묵직하게, 쫀득하게, 탱글하게, 차분하게, 경쾌하게, 날렵하게) and the exaggerate-first tuning workflow. Usage notes that an MCP session keeps its version until it reconnects.

## 0.3.1

- **`nudg compare` / `nudg_compare`:** two versions under the same events, for a person to judge. A perceptibility verdict first (imperceptible / subtle / clear, per property: max difference, overshoot, settle time), then real A/B filmstrips in rows (with the host HTML) or one graph with both curves (`plot` gained `against`). When nothing crosses perception it proposes an exaggerated version. The MCP instructions tell the AI to show it whenever it changes motion for a person.
- **Presets:** `presets.press()`, `hover()`, `toggle()`, `toast()` return ready-made documents, so the simple case is one line with no file: `useNudg(presets.press())` or `playDoc(presets.toast(), element)`. `nudg preset <name>` prints one as a file to edit. `useNudg` compiles inline documents by content, so a preset call in render doesn't recompile or reset.
- **Docs:** `simulate` and `plot` check the file; `render --html` and real-page tests check the app.

## 0.3.0

Stage 1 continued: what the component guidelines (WAI-ARIA APG, Apple HIG, Material 3) need. A 0.3 runtime still reads 0.1 and 0.2 files.

- **Format v0.3:** key events (`target.key.<name>`, lowercase `KeyboardEvent.key` names); `after:<time>` timers in a state's `when`, deterministic and restarted on re-entry; `step` and `commit` transitions that change a property's base value, with property bounds (`{ "base", "min", "max" }`) that also default a `follow`'s range.
- **Runtime:** a `reducedMotion` option (short linear tweens, no kicks); the DOM adapter follows `prefers-reduced-motion`, and `simulate`/`plot`/`render` and the MCP tools take `--reduced-motion` / `reducedMotion`. The DOM adapter sends key events for keys the file handles (and prevents their default), reflects timer-driven state changes, and exposes `player.values()`.
- **React hook:** `files` keys may be written like imports (`./x.nudg.json`); `reducedMotion` option.
- **Examples:** slider, tooltip, dialog (WAI-ARIA patterns), and the toast now hides itself with a timer. JSON Schema 0.3 (`@nudg/core/schema.json`; 0.1 and 0.2 still ship).

## 0.2.0

Stage 1: continuous interaction. A 0.2 runtime still reads 0.1 files.

- **Platform motion libraries** (shipped in the package as `@nudg/core/motion/*.nudg.json`): `motion/apple.nudg.json` (SwiftUI `smooth`, `snappy`, `bouncy`), `motion/material-expressive.nudg.json` and `motion/material-standard.nudg.json` (Material 3 spatial and effects tokens), all from published values, plus the common names `standard`, `quick`, `gentle`, `playful`, `fade` so one import line changes the feel. Examples `ios-toggle` and `material-switch` show the same machine with different imports; host markup follows the WAI-ARIA switch pattern.
- **Examples site:** browse by category, tag or search; detail pages with nudg / HTML / React source and prompts to try with an AI; a playground for any file; Reset per example; a no-cache dev server and a startup banner. Nine more examples (button press, hover card, shake, toast, segmented control, accordion, carousel, bottom sheet, pull to refresh) and `examples/index.json`.
- **DOM adapter:** `data-nudg-state` on every bound element for state-driven CSS; `composedPath()` for shadow roots; taps suppressed on every target under a pointer that dragged.
- **Format v0.2:** drag events (`dragstart`, `dragend`) and inputs (`target.drag.x` / `.y`); `follow` to track an input with `range` and `overdrag`; `nearest` transitions that settle where a throw was heading, with the finger's velocity carried into the spring; `map` for values derived from another property (numbers and OKLab colors); machine-level `when`; `hoverstart`, `hoverend`, `focus`, `blur` and app-sent `host.<name>` events; starting in states other than `initial`. Design decision 9: strings are never code.
- **Runtime:** drag velocity is computed by the runtime (least-squares over 0.1 s), so every platform agrees.
- **Tools:** `--drag`, `--input` and `--start` for `simulate`, `plot` and `render`; MCP tools take a whole drag as one item. Plot scripts wrap and summarize input samples.
- **Adapters:** DOM adapter handles drags (4 px slop, no tap after a drag, `touch-action: none` on drag targets), hover and focus, `player.input`, `player.bind` and `onState`. New React adapter: `useNudg` at `@nudg/core/react` (React 18+ as an optional peer dependency).
- **Spec:** JSON Schema 0.2 (`@nudg/core/schema.json`; 0.1 still ships), new conformance cases for drags, ties, overdrag, any-state transitions and 0.2 validation, and examples `toggle-drag` and `swipe-row`.

## 0.1.1

- The `nudg` command is installed again: npm dropped the `bin` entry from 0.1.0 because of its `./` prefix.

## 0.1.0

First release of the format and its reference implementation.

- **Format v0.1:** plain JSON files with states, parallel regions and nested states; transitions on pointer events; values with logical units and hex colors; motion as springs (four parameter forms), tweens (named curves and cubic Bézier) and kicks; named motions and imports; `note` fields and `x-` extensions.
- **Validator:** every problem has a stable code, a JSON pointer and a fix hint, with aliases for names AI tools commonly reach for.
- **Runtime:** headless and deterministic. Springs are solved in closed form, retargeting keeps velocity, and colors interpolate in OKLab.
- **Tools:** `nudg validate`, `simulate`, `plot` (motion graphs), `render` (real frames through headless Chrome) and `mcp` (the same as MCP tools, plus a format guide for agents).
- **Adapters:** DOM (`@nudg/core/dom`).
- **Spec:** JSON Schema (`@nudg/core/schema.json`) and a language-neutral conformance suite whose expected values come from an independent derivation.
