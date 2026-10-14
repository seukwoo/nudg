# Changelog

## Unreleased

- **Platform motion libraries:** `motion/apple.nudg.json` (SwiftUI `smooth`, `snappy`, `bouncy`), `motion/material-expressive.nudg.json` and `motion/material-standard.nudg.json` (Material 3 spatial and effects tokens), all from published values, plus the common names `standard`, `quick`, `gentle`, `playful`, `fade` so one import line changes the feel. Examples `ios-toggle` and `material-switch` show the same machine with different imports; host markup follows the WAI-ARIA switch pattern.
- **Examples site:** browse by category, tag or search; detail pages with nudg / HTML / React source and prompts to try with an AI; a playground for any file; Reset per example; a no-cache dev server and a startup banner. Nine more examples (button press, hover card, shake, toast, segmented control, accordion, carousel, bottom sheet, pull to refresh) and `examples/index.json`.
- **DOM adapter:** `data-nudg-state` on every bound element for state-driven CSS; `composedPath()` for shadow roots; taps suppressed on every target under a pointer that dragged.

## 0.2.0

Stage 1: continuous interaction. A 0.2 runtime still reads 0.1 files.

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
