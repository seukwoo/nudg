# Design

The vision, scope, and decisions behind nudg, and the questions still open. The format itself is in [the spec](spec.md).

## Why

Today's interactive animation formats are binary files authored in a dedicated studio. That worked when a designer handed a finished asset to an engineer. It doesn't fit how software is built now:

- **Your AI can't edit it.** A binary file is a black box to an LLM. You can't ask for "make the toggle a little bouncier" and get a diff.
- **It can't be reviewed.** No meaningful diff, no code review, no history you can read.
- **It needs the studio.** Every change, however small, goes back through one specific tool.

Meanwhile, more and more UI is written by people working with AI coding tools, moving fast, inside the repo. Interactions should be able to live there too.

nudg is meant to slip into that workflow instead of asking you to leave it.

## Principles

### AI-native

These are concrete requirements, not a slogan. Each one is something the format and tooling must actually do:

1. **Text source.** A small vocabulary an LLM can write correctly without a page of examples. Compact, diffable, stable identifiers for targeted edits.
2. **Validator with fix hints.** Errors are machine-readable and say how to fix them, so an AI can correct its own output in a loop.
3. **Headless simulation.** Send events, advance time, and inspect state without rendering anything, so behavior can be tested, not just looked at.
4. **Frame rendering.** Render any moment to an image so a multimodal model (or a person) can check what it actually looks like.
5. **CLI and MCP from day one.** Every capability is callable by an agent. A visual editor may come later, but the text stays the source of truth.

### Any platform

Edit one file, and every platform picks up the change.

The nudg core never draws anything. It takes events in and gives property values out. The host app applies those values to its own views:

```
 host app (web, iOS, Android, Flutter, Unity, Qt, ...)
   │  events: tap, drag, data changed
   ▼
 ┌──────────────── nudg core ────────────────┐
 │  state + time + motion (headless)          │
 └────────────────────────────────────────────┘
   │  values: knob.x = 18.3, track.color = #4ADE80
   ▼
 host applies values to its own views (thin adapter)
```

Any platform that can set a property and send an event can run nudg. A new platform needs only a thin adapter.

- **The spec is the source of truth, not an implementation.** Behavior is defined by the spec plus a language-neutral conformance suite: event sequences and timestamps in, expected states and values out. Any runtime that passes the suite is a nudg runtime.
- **The core stays small.** State transitions, the clock, and motion math (springs, tweens). A small core is cheap to port, and ports are checked by the conformance suite.
- **The reference implementation is TypeScript.** It is the fastest to iterate on and matches the first target. A portable core (for example Rust via WASM and FFI) can come later without changing the format.
- **Code generation stays possible.** Teams that don't want a runtime dependency can compile a nudg file to platform code (SwiftUI, Compose, ...).

## Scope

See [Roadmap](roadmap.md) for the current development plan. This page explains the shape of the product; the roadmap tracks the order in which that shape should become real.

### Where it starts: mobile-first UI interactions

A micro-interaction is a small, self-contained UI moment with one job: trigger → rules (state) → feedback (motion). Examples:

- A like button whose heart pops when tapped
- A toggle whose knob springs across the track
- A button that sinks slightly while pressed
- An input that shakes on invalid entry
- Pull-to-refresh, swipe-to-delete
- A tab indicator that slides to the selected tab
- A toast that slides in and out

The first implementation target is the web because it is easiest to install, test and show, but the interaction model is mobile-first. Modern web products are already designed with touch, bottom navigation, sheets, snackbars, cards, swipe rows and responsive grids in mind. Starting from mobile-quality patterns makes the behavior portable to web today and native later.

This is the first target because the gap is real: full animation tools are overkill here, and CSS alone gets messy once state is involved. It is also where people building with AI coding tools are the most numerous, and the pieces are small enough to polish to a high bar.

### Semantic patterns

Natural-language UI work breaks down when every request is re-inferred into fresh code. One agent may make a good Material-style FAB; the next may make an absolute-positioned button with no press feedback, state, or accessibility story. nudg should give those common words a standard starting point.

A semantic pattern maps a human UI noun to the parts, states, events and motion a designer or mobile engineer would expect:

| Word | Expected behavior |
|---|---|
| `fab` | a primary floating action with press feedback, optional extended label or expand/collapse |
| `tab-bar` / `tabs` | selected state, indicator motion, focus and keyboard support where relevant |
| `bottom-sheet` / `sheet` | enter/exit, backdrop, drag handle, snap points, dismiss |
| `toast` / `snackbar` | enter, timer, optional action, dismiss, exit presence |
| `swipe-row` | horizontal drag, reveal action, threshold, close or dismiss |
| `list` / `grid` | item insertion, removal, reorder and responsive collection behavior |
| `dialog` / `popover` | present, dismiss, backdrop or anchor, focus return |
| `switch` / `slider` | tap, drag, keyboard step, committed value and reduced-motion behavior |

These patterns should begin as presets, examples and guide rules before they become format fields. The core format stays small; a pattern library can compile a familiar word into ordinary nudg states and motions. The important contract is:

```
human UI words
  -> semantic pattern
  -> states, events, targets and motion
  -> compare / observe
```

The first pattern vocabulary is intentionally mobile-heavy: FAB, tab bar, bottom navigation, navigation rail, drawer, app bar, sheet, snackbar, toast, card, list, grid, carousel, switch, slider, dialog, popover, chip, badge, progress, pull-to-refresh and swipe actions. Web and enterprise names such as GNB, LNB, side nav, breadcrumb, data table and tree view are also useful aliases when the host app is broader than mobile.

### Where it grows

The scope grows from single elements to components, screens and flows, native hosts, and eventually exploratory standalone content. Semantic patterns carry familiar interaction intent through component and screen work. The original numbered stages and their current status are maintained in the [roadmap](roadmap.md#product-stages).

### What nudg is not

- **Not a drawing or illustration tool.** Character animation, bones, and mesh deformation belong to tools built for them.
- **Not a design tool.** nudg animates the components you already have. It doesn't replace your design system.
- **Not a general-purpose state management library.** It is scoped to interactions and motion.

## Design decisions

These are expensive to change later, so they are fixed early:

1. **Platform-neutral vocabulary.** Abstract properties (`x`, `y`, `scale`, `rotation`, `opacity`, `color`, ...), never CSS or platform syntax. Adapters translate.
2. **Composition.** The grammar allows machines inside machines (nested states, composed components) from the start, even before stage 0 uses it.
3. **Deterministic clock.** The same events at the same times always produce the same states and values. Simulation, frame rendering, and the conformance suite depend on it.
4. **Open event namespace.** Pointer and keyboard first; gestures, sensors, and app data later, without breaking existing files.
5. **Versioning and extensions.** Every file declares a format version, and there is a defined rule for unknown fields and namespaced extensions.
6. **Core and renderers are separate.** The headless core is pure logic; drawing is always an adapter's job.
7. **Units: all supported, with a default.** A bare number is a *logical unit*. On every major platform this is already the same size: a CSS `px`, an iOS `pt`, and an Android `dp` are all density-independent logical units. `px`, `pt`, and `dp` are accepted as aliases for it. `%` is relative. Other units can arrive through the extension rule.
8. **Targets are bound by name.** A nudg file refers to targets by name (`knob`, `track`) and never knows what they are on a given platform. The host registers which of its views each name means, for example `bind("knob", element)`. On the web, `data-nudg="knob"` attributes bind automatically. The validator and runtime report names that are used but never bound, and the reverse.
9. **Strings are never code.** A string is always a name (a state, a motion, a target path) or a value (`"#4ADE80"`, `"300ms"`); the only free text is `note`. Computation is always an object with one operator key (`map`, `follow`, `nearest`, ...), from a small closed set that grows only when a real interaction needs it. There is no expression language, so a reader (or an AI) never has to guess whether a string is a formula or a sentence, and the validator can check every operator precisely.
10. **Semantic patterns compile to primitives.** Words like `fab`, `bottom-sheet`, `swipe-row` and `toast` are product vocabulary, not new runtime magic. They should be represented first as presets, recipes and guide rules that produce ordinary targets, states, events and motion. Only promote a pattern concern into the core format when several patterns need the same lower-level capability.

## Proposal: layout as input (format 0.4)

Status: implemented in stages: format 0.4 added `measure` in `values` and `set`, retargeting and DOM measurement; format 0.6 added arithmetic; format 0.9 reuses the same measure objects in `follow.range` and `map.from`. Settles the open question "Layout: measured positions and sizes" for current component recipes. The cases that force it are a tab or segmented indicator whose size depends on its label, an accordion that opens to natural height, a bottom sheet whose snap points depend on the screen, and a swipe row whose action width defines its drag and reveal.

**The core never measures.** Measuring is the host's job, like the pointer: the adapter reports each bound target's layout as inputs, the same kind of value as `drag.x`, and the core reads them. This keeps decisions 3 (deterministic clock), 6 (core and renderers separate) and 9 (no expressions) intact, and the conformance suite can state layouts as given numbers.

**Inputs.** For every bound target the host supplies `target.layout.x`, `target.layout.y`, `target.layout.width`, `target.layout.height` (the untransformed box, in logical units, in one coordinate space per player: whatever motion nudg applies is not part of the layout) and `target.layout.naturalWidth`, `target.layout.naturalHeight` (the size the content needs when unconstrained; what CSS calls `auto`). The host reports them on bind and whenever they change (resize, font load, content change).

**One new operator, `measure`,** usable wherever a number is: in `values`, in a state's `set`, and as a `nearest` target. Its value names a target and a measurement:

```json
"states": {
  "second": { "set": { "indicator.x": { "measure": "seg2.x" }, "indicator.width": { "measure": "seg2.width" } } }
}
```

- **Position (`x`, `y`) aligns.** `{ "measure": "seg2.x" }` on `indicator.x` is the translation that puts the indicator's box where seg2's box is: `seg2.layout.x - indicator.layout.x`. That is what a tab indicator, a highlight, or a shared-element move needs, and it never depends on which coordinate space the host chose.
- **Size (`width`, `height`, `naturalWidth`, `naturalHeight`) is the size.** `{ "measure": "content.naturalHeight" }` on `content.height` opens an accordion to exactly its content.
- **Arithmetic stays deliberately small.** Format 0.6 adds `{ "measure": "sheet.height", "times": 0.5, "plus": -16 }`: multiply the measured size or aligned position, then add a logical-unit offset. It is not an expression language.
- **Endpoints reuse the same object.** Format 0.9 allows measure objects in `follow.range` and `map.from`, so the bounds and derived feedback use the same measured resting point. Before layout arrives a follow is unbounded and a map holds its base; relayout updates both without restarting the follow.
- **Relayout retargets.** When a measured input changes while the value is resting on it, the value moves to the new target with the property's motion, as if a state set it. A window resize slides the indicator; it doesn't jump.
- **Before the first report** a measured value is its property's base value, and the runtime reports which measurements it is still waiting for, the same way it reports unbound targets.
- **`%`-like values** use `{ "measure": "parent.width", "times": 0.5 }`; there is no separate unit system.

**Tools.** `simulate`, `plot`, `compare` and the conformance suite take a layout table (`--layout seg2.x=72,seg2.width=88`, or `layout` in the MCP tools); `render` and `observe` measure the real page. The validator checks the target exists, the measurement name, and that `x`/`y` only measure into position properties.

**Adapters.** The DOM adapter measures with offsets (untransformed) and natural size with scroll size, and reports again from a `ResizeObserver`. React needs nothing new. A native adapter reports the view frame.

**What it does not do.** No layout engine, no FLIP of arbitrary reflows (Motion's `layout` prop animates any layout change; nudg animates the properties a file names toward measured targets). A list reorder or a shared-element screen transition is stage 2 and builds on this, not the other way around.

**First cut, in order:** `measure` for `x`/`width` in `set` and `values` with retargeting; `segmented` and a new `tabs` example without hard-coded widths; `naturalHeight` and an `accordion` that opens to its content; then `nearest` over measured targets for a bottom sheet. Each with conformance cases in `derive.py` first.

11. **Native runtimes read compiled programs.** Validation, error messages and hints live in one place, the reference implementation; runtimes on other platforms read the compiled form (`nudg compile`) and are checked by the same conformance suite. A file is validated where it is written (the editor, the AI's loop, CI), not on the device.
12. **The headless player is the renderer boundary.** `createPlayer` receives events and continuous inputs and emits state and property values through callbacks. DOM, React Native, SwiftUI, Compose, Canvas or another renderer applies those values; nudg keeps the deterministic state and motion math. A renderer may use another scheduling or drawing library, but replacing nudg's motion solver with an external physics engine would make conformance and cross-platform playback impossible.
13. **Accessibility semantics belong to the host.** A web adapter must not put ARIA into the platform-neutral interaction grammar, just as the core must not encode SwiftUI or Compose accessibility APIs. Recipes state keyboard, focus and semantic responsibilities; accessible components such as Radix or React Aria keep owning them; adapters may observe their state and motion tooling may audit timing, Escape and reduced motion. Promote semantic metadata into runtime files only if external recipe contracts prove insufficient.

## Proposal: continuous app inputs

Status: first cut implemented as format 0.5: `map` and `follow` read app and scroll inputs, the DOM adapter reports referenced scroll offsets, and microphone and shrinking-header examples exercise both host and adapter input. Scroll-direction events remain future work. The cases: a circle that grows with the microphone level, a card that tilts with the phone, a progress ring that follows a download, an app bar that hides as the page scrolls. Events (`host.show`) can't say these; they are values that change every frame.

**The app supplies values as inputs, the same way the adapters supply the pointer and the layout.** `player.input("host.volume", 0.7)`, at any rate. The name is the app's own, as with `host.*` events, so the validator accepts any `host.<name>` and the guide asks for names that say what the value is.

**Files read them with the existing operators, not new ones:**

- `map` from an input: `"ring.scale": { "map": "host.volume", "from": [0, 1], "to": [1, 1.6] }`. Today `map` reads a property; reading an input is the same piecewise-linear rule, applied to the input's latest value.
- `follow` an input in a state, as with a drag: `"follow": { "card.rotation": { "input": "host.tilt", "range": [-8, 8] } }`. It moves with the input from where the value was when the state was entered.
- `nearest` and velocity work as for drags, since inputs keep their history.

**Scroll** is the same idea, supplied by the adapter: `target.scroll.y` is the scroll offset of a scrolling target, usable by `map` (a header that shrinks as the page scrolls) and `follow`. Hiding on scroll direction needs events too (`target.scrollup` / `target.scrolldown`, sent past a threshold), which would be the first events derived from an input.

**What it does not do:** read devices. Microphones, cameras, motion sensors and file downloads are the app's business; nudg receives numbers. An adapter may offer a thin helper for the most common ones (scroll), never a sensor.

**First cut:** `map` and `follow` from `host.*` inputs and `target.scroll.*`, a microphone example (the site feeds a level from the Web Audio API) and a shrinking header, with language-neutral conformance cases.

## Pausable state timers

Status: implemented as format 0.7. An `after:` transition owns its timeout and may list independent `{ "on", "off" }` reasons. The first active reason freezes remaining time and the final reason to clear resumes it. Leaving or re-entering the state resets the timer and all reasons; a timer due at the same timestamp still fires before an incoming event. The host reports lifecycle events such as suspension or scrubbing, while the core remains deterministic and platform-neutral.

## Transient entry keyframes

Status: implemented as format 0.8. Keyframes live only under a state's `enter`: the sampled current value is the implicit start and the resolved state target is the implicit end. This makes re-entry continuous, gives interruption a well-defined outgoing velocity, lets relayout change the destination, and keeps the state responsible for every resting value. Reduced motion skips the authored sequence. General delay, sequence and stagger semantics remain separate because current recipes do not require them.

## Type-safe host contracts

Status: implemented as `nudg generate` and the `nudg_generate` MCP tool.

A host names things in a file: targets to bind, events to send, inputs to supply, states to start in or exit through. A misspelling compiles and fails quietly at run time (`send` returns false). `nudg generate x.nudg.json` writes `x.nudg.ts` beside it, a types-only module with one interface:

```ts
export interface ToggleDragContract {
  targets: "knob" | "track";
  events: "host.check" | "host.uncheck" | "track.tap" | "track.dragstart" | "track.dragend";
  inputs: "track.drag.x";
  states: "off" | "on" | "dragging";
}
```

The decisions:

- **Types only, passed to the existing adapters.** `useNudg<ToggleDragContract>(toggle)`, `play<C>`, `playDoc<C>` and `createPlayer<C>` take the contract as a type argument and default to plain strings, so untyped use is unchanged. The module has no run-time code and no import of the JSON, so it works with any bundler and costs nothing in the bundle. Wrapping the document (a generated module that imports and re-exports the JSON) was rejected because JSON import syntax still differs between bundlers.
- **Names come from the compiled program.** Imports are resolved by the compiler, so one interface covers a file and everything it imports. Events are the ones the file handles (`when` keys and timer pause reasons); inputs are the ones it reads with `map` or `follow`, without layout measurements, which the adapters report; states are every path, as `state` reports them and the `state` option accepts (`playback/paused`). `exit` also accepts a path's last name, as the adapters do.
- **Staleness is checked by regenerating, not by hash.** `nudg generate --check` writes nothing and fails when a module is missing or differs from what would be generated. The design discussion first proposed embedding a hash of the source; comparing the output is stricter where it matters (a generator change is caught) and looser where it doesn't (reformatting the JSON without changing a name is not stale). CI runs `--check`; the module is committed beside its file.

## Open questions

These are unresolved design choices. Scheduling and completion status live in the [roadmap](roadmap.md); examples of possible syntax below are proposals.

- Transitions that cross machine levels (to a parent's sibling, into a nested state).
- A final state in the grammar (`"final": true`, as in statecharts) to say "this state means the component is gone". Today the host names exit states in the adapter options (`exit: "hidden"`), because mounting and unmounting are the host's lifecycle; a file-level marker would let the tools (`observe`, the guide) know it too.
- Layout: formats 0.4, 0.6 and 0.9 implement measurement, arithmetic and measured follow/map endpoints. Measuring across players remains open.
- Pattern metadata currently lives in the versioned external recipe catalog. Revisit a file-level role such as `"role": "bottom-sheet"` only if generation or validation needs cannot be met without changing runtime documents.
- Pattern aliases and locale: how to map common design words such as FAB, snackbar, toast, tabs, tab bar, bottom nav, GNB, LNB and side nav without making the core format depend on one design system's names.
- Decay (fling, inertia) as a motion of its own, for scroll-like content without snap points. Snapping is covered by `nearest`.
- Reduced motion inside the format: a way for a file to say which properties must not be reduced (a progress bar's width), beyond the runtime's blanket option.
- Discrete steps for `commit` (a slider that snaps to 10s), beyond `min`/`max`.
- Nonlinear rubber banding that depends on the view's size, instead of the linear `overdrag` factor.
- Continuous motion while a state is active (a spinner turning, a marquee): a rate-driven value, and how it hands off when the state is left (a rotation at 720° shouldn't unwind to 0). Today this is left to CSS through `data-nudg-state`.
- `nearest` limited to neighbors of the current state (a carousel that moves one slide per swipe however hard the flick), instead of tuning `momentum` down.
- Pinch, rotate and other multi-pointer gestures.
- Continuous app inputs and scroll position are implemented in format 0.5. Still open: portable direction and velocity derivation, including thresholds and how those become deterministic events.
- SSR initial output: how a server asks a compiled program for initial styles without a clock or platform APIs, how the client hydrates the same values, and how unresolved layout measurements or app inputs use their documented base values without a flash.
- Lifecycle subscriptions beyond `onState`, `onFrame` and exit-specific `onExit`: define one portable settled/transition-complete semantic for interrupted motion, parallel regions and timers before exposing it in every adapter.
- DOM CSS-variable output: whether an optional adapter mode should write custom properties so host CSS composes transforms and visual properties, rather than writing final inline properties. This stays an adapter concern and needs real Tailwind/design-system cases before it displaces the direct, low-overhead default.
- More combinators: `sequence`, `delay`, `stagger`. Format 0.8 deliberately keeps keyframes as inline transient state-entry effects rather than making them a general sequence primitive.
- Tweaking a named motion at the point of use, for example `{ "use": "snappy", "duration": 0.5 }`.
- Schemes: which names a scheme may supply or override, how the host passes one in, and how the validator still catches misspelled names. The built-in Apple-like and Material-like libraries.
