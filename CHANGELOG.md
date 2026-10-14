# Changelog

## Unreleased

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
