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

## Loops while a state is active (format 0.10)

Status: implemented as format 0.10 in TypeScript, Swift and Kotlin, with the [spec](spec.md#loops) and conformance. Spinner, skeleton and typing indicator have starters, and pull-to-refresh turns its spinner with a loop. The most needed gap in the recipe catalog together with screen composition (`nudg recipe --gaps`): spinner, skeleton and typing indicator have no starter, and pull-to-refresh spins its spinner with host CSS through `data-nudg-state`. Screen composition is stage 2 work across players; loops stay inside one player.

```json
"refreshing": {
  "set": { "list.y": 64 },
  "loop": { "spinner.rotation": { "to": 360, "duration": 0.8, "wrap": 360 } }
}
```

**A loop is an offset added to the property while its state is active.** The property keeps its ordinary value (base, `set`, springs, kicks, keyframes); the loop adds a periodic offset on top. The offset is 0 when the state is entered, so entering never jumps, and it composes with whatever the state's springs are doing.

- **One cycle is a track from 0.** `"to"` is the offset at the end of a cycle, for a sawtooth such as a spinner (0 to 360) or a shimmer (0 to the travel distance); `"keyframes"` lists `{ "at", "value" }` points inside the cycle, for a pulse or a bounce, with 0 implied at both ends. `duration` is one cycle; `ease` applies to each leg, as for entry keyframes, default `linear`.
- **`delay` starts the cycle later and keeps the phase.** The offset stays 0 for `delay` seconds after entry, then cycles; typing dots are the same loop with delays 0, 0.15 and 0.3 s. This is the one stagger loops need, without a general stagger primitive.
- **Leaving hands off like a drag.** The property continues from its displayed value, with the loop's velocity, toward its new target, with the destination's motion. `wrap` (a period, e.g. 360 for a rotation) first reduces the offset to the nearest equivalent of 0, so a spinner at 630° stops by turning 90° forward, not 630° back.
- **Values may be measured.** `to` and keyframe values take the 0.9 endpoint form (`{ "measure", "times", "plus" }`), so a shimmer travels its placeholder's measured width.
- **Rest.** A looping property counts as at rest, like a followed one: `onSettle` reports once the state's other motion is over, and exit is unaffected. The runtime gains `looping()`, true while a loop is active, so adapters keep drawing frames.
- **Reduced motion** holds the offset at 0: no looping, the state's other values still apply. A spinner then needs a visible status (text, `aria-busy`), which the recipe already lists as a host responsibility.
- **Errors.** A property can't loop and follow in the same state, a mapped property can't loop, two parallel regions can't loop the same property, and colors can't loop (offsets are numeric). A map may read a looping property, which is how a shimmer's highlight can fade at its ends.

**Starters it enables:** spinner, skeleton, typing indicator (with `delay`), and pull-to-refresh without the CSS workaround. Sequence and stagger outside loops (menu, speed dial, accordion) came in 0.12 as a motion delay.

**Not in this cut:** loops that run a fixed number of times (an attention shake that repeats twice is entry keyframes, or a timer back to the state), loops on colors, and rate-driven values from app input (a progress-driven rotation is a `map`).

## Screen transitions are one player with roles (format 0.11)

Status: implemented. The recipe catalog had stack navigation, full-screen modal, shared element and drawer as gap-only under "screen composition", the most counted gap, on the assumption that two screens need two players composed. Trying them showed otherwise:

- **A transition is one player whose targets are roles.** `screen` and `previous`, `modal` and `presenting`, `card`, `thumb` and `hero`: the host binds whichever screens play those roles for this transition. A deeper stack binds the top two screens for each push or pop; nothing in the file knows the depth.
- **Mounting is the host's, as for any exit.** Both screens stay mounted while the player moves; the host unmounts the popped or dismissed one when the player settles in its exit state, which `onExit` already reports.
- **Positions and sizes are already measured.** Shared element moves a card between two measured boxes with 0.4 measured targets; the DOM adapter measures untransformed layout, so the moving card never measures itself.
- **The one missing piece was a measured map value.** A stack's previous screen moves a third of a width while the new one moves a whole width, and a push drawer moves the content a share of its own width: both are maps from a measured position to a measured distance. Format 0.9 allowed measured `from` points; 0.11 allows measured `to` values, with the same rules.

Composing several machines remains open for flows that need it (onboarding, multi-step forms); no current recipe does.

## Sequence and stagger are a delay per property (format 0.12)

Status: implemented. Accordion, menu and speed dial needed things to move in order: the content after the panel makes room, menu items one after another, actions out from the button and back in reverse. A general `sequence` combinator (a list of steps) was the expected answer. A timeline is simpler: each property's motion gets its own start delay, and order is just different delays.

- **The delay lives on the motion in `animate`.** A transition's `animate` already overrides motion per property, so a stagger is a transition with growing delays, and the reverse order is the closing transition's own delays. No new structure, no step list to keep in sync with the states.
- **States still say where.** A delay only says when a property starts going there; interruption stays the existing rule (retarget from the current value and velocity), with one addition: a pending motion that hasn't started is dropped.
- **Not in named motions or entry kicks.** A delay is choreography of one transition; a reusable motion with a built-in wait would surprise every other use.
- **Loops already had their own `delay`** (0.10); this is the same word for the same idea on ordinary motion.

## The host declaration, not a store (format 0.13)

Status: implemented. Two questions came up together: should nudg have a store, variables that hold app data, and is `host.*` enough for both app data and sensors?

- **No store.** App data (checked, count, text) already lives in the app. A copy in the file would be a second source of truth to keep in sync, and variables invite conditions and formulas next, which would turn the file into a program an AI can no longer edit safely. The patterns that felt clumsy without one (a text field's four label states, a stepper's limits) are clumsy for lack of conditions, which stay out on purpose.
- **`host.*` carries everything the motion needs.** Two channels: events for things that happen (`player.send("host.connected")`) and inputs for numbers that change (`player.input("host.tilt", deg)`). Sensors are the same as data: the app reads the device and passes numbers; nudg never reads a device. Strings and lists are content, which the host renders.
- **What was missing was the declaration.** Any `host.<name>` was accepted, so a typo (`host.filed`) silently made a transition that never fires, and nothing said whether `host.volume` is 0–1 or 0–100. An optional `host` block names the events and inputs (with their range); with it, an undeclared name is an error with a hint, a map outside the range is a warning, and `nudg generate` lists the declared names, so the host's types and the file can't drift. Like `targets`, it is a header, not data.

## Gestures the runtime derives (format 0.14)

Status: implemented. Long press and double tap were possible only as a workaround (a state entered on `down` with an `after:` timer), which every file rewrote and which couldn't swallow the tap that ends a long press.

- **Derived in the runtime, not the adapters.** Both are functions of `down`, `up`, `cancel`, `dragstart` and `tap` over time, which every adapter already sends. Deriving them in the runtime makes them deterministic, shared by every host without new adapter code, and testable by the conformance suite; adapters would have needed their own clocks.
- **Only where the file asks.** A target gets them only when a transition handles them, so the tap of a target without `longpress` is never swallowed and older files see no change.
- **Fixed thresholds.** 0.5 s and 0.3 s, the platforms' defaults. A file that needs another hold time keeps the `after:` pattern.
- **No delayed single tap.** Waiting to rule out a double tap would make every tap feel late; the first tap is delivered at once, as on the web and on iOS without failure requirements.
- **Fling stays `nearest`.** A throw already chooses its state by projected position and momentum; a separate directional fling event would duplicate it.

## Events from continuous inputs (format 0.15)

Status: implemented. Hide-on-scroll needed the scroll's direction, and a voice UI that switches to "speaking" above a level needed an event from a number; maps alone can't change state.

- **A crossing is written where it is used.** `"host.volume>0.6": "speaking"` in a `when`, instead of a declared list of named thresholds elsewhere: the condition is readable at the transition and an AI edits one place. Only `>` and `<`, no expressions.
- **Inputs only.** Inputs arrive as samples, so "crossed between two samples" is exact and the same in every runtime. A property's value between frames depends on the sampling rate, so crossings on properties would differ between a 60 Hz and a 120 Hz screen.
- **Fires on entering, re-arms on leaving.** A level that stays loud fires once; a toggling pair (`>0.6` speaking, `<0.3` quiet) gives hysteresis by choosing two values.
- **Scroll direction is a built-in pair of events**, with an 8-unit turn threshold measured from the furthest point, so a finger's wobble or an elastic bounce doesn't flip a bar. Direction plus a crossing near the top covers hide-on-scroll; velocity was not needed.

## Glide: decay with the same momentum as nearest (format 0.16)

Status: implemented. A free-scrolling carousel and an image viewer's pan need a released value to travel on and slow down with no target to settle at. Snapping was already covered: `nearest` projects where a throw is heading as velocity × momentum.

- **Exponential decay with the same constant.** The glide's time constant is the `momentum` that `nearest` uses, so a glide stops exactly where `nearest` would have projected. One number means "how far a throw carries" everywhere, and 0.5 s is close to a native scroll view's normal deceleration.
- **A state-level `glide`, like `follow`.** The state that follows the finger hands over to the state that glides; the gliding state is where the value rests, so leaving it is a choice the file makes, not something the glide forces.
- **Bounds settle with the property's spring.** Reaching a bound hands the remaining speed to the same motion that `animate` gives the property, so the end feels like the rest of the component; there is no separate rubber-band parameter.
- **Not under reduced motion's control.** The travel is the user's own throw; only the settling at a bound becomes the short tween.

## A list is one player per item (format 0.17)

Status: implemented. The animated list was the last "collection coordination" gap, expected to need machines per item inside one file. Writing it showed the same answer as screen transitions:

- **One player per row, the order in the host.** Insert, remove and the neighbours' shifts during a drag are each one row's own states, driven by host events; which rows shift is index arithmetic on the app's data, which the host owns anyway. In React each row component calls `useNudg`; on the web the example's `list-host.js` plays one per row.
- **The one missing piece was a target from the app.** The dragged row has to spring to the slot the host computed, and `map` jumps while `follow` adds deltas. Format 0.17 lets a `set` target read an input, like a measured target reads layout; a new sample retargets with the property's motion. It serves more than lists: a gauge, a progress ring or a counter that springs to the app's value.
- **Committing the order without a jump.** Once the drop settles, the host reorders the page and sends `host.commit`, a transition whose `animate` is a zero-length tween, so every row is at rest exactly where the new layout puts it.

## Pinch: two pointers and a multiplying follow (format 0.18)

Status: implemented. The image viewer was the last gap: a pinch's scale, turn and centre come from two pointers.

- **A pinch is inputs, like a drag.** `pinch.scale`, `pinch.rotation`, `pinch.x` and `pinch.y` start at 1, 0, 0, 0 on `pinchstart`, so `follow`, `map`, crossings and velocity work on them unchanged.
- **Zoom multiplies.** Following a ratio by adding its change is wrong as soon as the value isn't 1 (a second pinch from 2x by 1.5 should reach 3x, not 2.5x), so `follow` gained `multiply`. It is one flag on the existing operator rather than a pinch-specific one.
- **The tracker owns the rules, once.** The shared `PointerTracker` (TypeScript, Swift, Kotlin) turns pointers into events and inputs and is checked against the same sequence in every language; the DOM, React Native and Compose adapters feed it raw pointers. SwiftUI only exposes the system's magnify and rotate recognisers, so its pinch has no midpoint; that is a platform limit, documented, not papered over.
- **Zoom about the midpoint is the file's choice.** The example moves the image with the midpoint and scales about its centre; a file that wants the midpoint fixed under the fingers can map its translation from the scale.

## 1.0: what is stable

Status: complete in 1.0.0 (see the [roadmap](roadmap.md#completed-10-stable-on-every-platform)).

- **The format becomes "1.0".** 0.18's semantics are frozen under `"nudg": "1.0"`, so a file says plainly that it uses the stable format. Every 0.x file keeps working unchanged: runtimes read all of them, and `nudg upgrade` only raises the version string once the file validates, since every 0.x addition is a superset of the one before.
- **Within 1.x, everything only gains.** New fields, events, inputs and error codes may appear with a new 1.x version, as 0.x additions did; nothing a 1.0 file says changes meaning, no error code is renamed, and no exported API is removed or narrowed. A change that breaks waits for 2.0.
- **Native is in scope.** The format and conformance are already shared by the TypeScript, Swift and Kotlin runtimes; 1.0 also freezes the Swift package's and the Kotlin modules' public APIs and the React Native hook, and checks them on an iOS simulator and an Android emulator rather than only in their conformance runners.
- **What is not frozen:** the examples site, the recipe catalog's contents (recipes may be added and improved; the catalog schema is versioned separately), the motion libraries' values, and anything documented as experimental.

## Reduced motion keeps fades (format 1.1)

playsnack's review of 0.12 found the gap: its loading dots pulse opacity, and under reduced motion 0.10's rule ("loops don't play") turned them into three still dots, so the indicator stopped saying "still working". An opacity pulse moves nothing; it is exactly what reduced motion leaves alone.

- **The rule follows what reduced motion is for.** WCAG 2.3.3 is about motion animation (movement, scaling, rotation, parallax), and the platforms' guidance replaces movement with fades rather than removing feedback. So from 1.1 a loop on `opacity` keeps playing under reduced motion; loops on position, size, scale and rotation still stop. Colors can't loop, so opacity is the only property that fades.
- **By property, not by a field.** A file could mark loops "keep under reduced motion", but then every author decides what reduced motion means, and a spinner marked to keep turning would defeat the setting. The property already says whether a loop moves.
- **Opted into by version.** 1.0 promised that a 1.0 file's meaning never changes, and the reduced-motion rules are part of that meaning, so a file gets the new rule by declaring 1.1; `nudg upgrade` does that. Compiled programs already carry the file's version, so the program format stays 8, and a 1.0 runtime given a 1.1 program falls back to stopping the fade, the old and safe behavior.
- **Only loops.** Entry keyframes and kicks on opacity are one-off accents; nothing has needed them under reduced motion. A spinner whose only signal is a turn still shows nothing under reduced motion; its recipe asks the host for a busy label, and a starter that wants a visible signal can add an opacity pulse.

## Judging on native: the comparison travels as data

On the web, `compare` shows the real component by snapshotting it from the running page. A SwiftUI or Compose view can't be snapshotted from outside the app, and the CLI can't compile the app's view code, so the person working on a native app had graphs and numbers but nothing to look at.

- **The app plays it, not the tool.** `nudg compare --bundle` writes the comparison as data: both versions compiled (the same program format runtimes already read), the events, and the verdict. `NudgCompare` (SwiftUI, Compose, React Native) takes it and a closure that builds the app's own view for one player, and plays two players side by side. What the person sees is their component, not a stand-in.
- **The same promises as the web page.** The headline first, before on the left, the change on the right, a loop with a pause at rest, Replay, ¼× and ⅒× (one shared clock that runs slow), and whatever the person does on one side happens on the other. Layout reports stay each side's own.
- **Where it runs is the host's choice.** A SwiftUI preview or a Compose debug screen; nothing is added to release builds unless the app puts it there. The views take the player as a parameter instead of creating it, which is also what makes them testable.
- **Verdict from one place.** The sentence is computed by the reference tools and carried in the bundle; native code doesn't reimplement perception thresholds.

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

## Settle: when motion is over

Status: implemented as `onSettle` in every adapter, with the rest rule in [the spec](spec.md#rest-and-lifecycle).

Hosts asked "is it done?" in several ways: React's transition bridge called a library's `onEntered` on the next frame because nothing better existed, and native adapters had no exit at all. One notification now answers it everywhere. The decisions:

- **Motion only, not timers.** A settle means every value is at rest, whatever timers are pending. A toast settles once shown while its dismiss timer runs, and again once hidden; video controls settle while their auto-hide timer counts. The existing `settled` (no unpaused timer either) keeps deciding presence and when a real-time host may stop its frames.
- **One per rest, for the whole player.** Interrupted motion reports only the rest after the interruption; there is no "cancelled" callback, because the active states already say where it ended. Parallel regions don't report separately; `runtime.settled(t, property)` remains for one property.
- **Followed and input-mapped values are at rest.** A drag that follows the finger and a meter mapped from a level never report; the release that springs to a state does.
- **The threshold is part of the spec.** Rest used to be advisory, so runtimes could disagree on the frame motion ended. The spring-energy threshold is now specified and covered by a conformance case, and each language has the same small lifecycle helper that adapters drive.

## Server rendering: the first frame

Status: implemented as `style(name)` in the React hook, `initialStyles` / `cssText` in `@nudg/core/dom`, and an `inputs` option on the hooks.

The DOM adapter writes styles in a layout effect, which prevents a flash in client-rendered apps but not in server-rendered ones: the server's markup paints first, without nudg's values. The decisions:

- **The first frame is a pure function.** Starting states, app inputs as given (others 0), measured values at their base, no entry effects: `initialValues(program, options)` in the core, with no clock or platform API. The DOM adapter and the server share one CSS conversion (`styleOf`), so they cannot disagree.
- **React gets `style(name)`, not a props bundle.** `bind` stays a ref; the style object merges with the component's own style explicitly. Its value never changes after the first render for a program, so React doesn't fight the adapter's frame writes.
- **Inputs the server knows are an option.** `inputs: { "host.progress": 0.6 }` sets the first frame and is applied at mount; later values go through `input`. React Native takes the same option for its first frame.
- **Measured values can't be known on the server.** They render at their base and move to the real layout on the first report. Authors give measured values a base close to the expected layout; a later option could let the server pass expected sizes.

## Recipes without a starter

Status: implemented in recipe catalog version 2.

Common UI words such as menu, spinner, drawer or shared-element transition need a standard answer even where the format can't express their essential motion. Without one, an AI improvises: it fakes a stagger with timers, or a spinner with a state that never settles. The decisions:

- **A null starter, not a separate list.** `"starter": null` keeps one record shape, so lookup, aliases and the contract fields work the same way; the schema then requires no examples and at least one missing gap. A separate "known gaps" catalog was rejected because the same word would have two places to look.
- **Gap capabilities are a fixed list.** `sequence`, `stagger`, `collection coordination`, `continuous motion`, `scroll direction`, `screen composition`, `multi-pointer` and `decay`. Free text made the same need countable only by reading; the list grows when a recipe needs something new.
- **Variants that need a missing capability get their own recipe.** Hide-on-scroll and the free-scrolling carousel moved out of `app-bar` and `carousel`, whose starters do the expressible variant, so each gap is counted once, against the pattern that needs it.
- **The count chooses the next primitive.** `nudg recipe --gaps` lists each capability with the recipes that need it. Ties are broken by how many more recipes the primitive would turn into starters, not by the count alone.

## Activation is a tap on every platform

On the web an adapter turns `click` into `tap`, so a keyboard or a screen reader activating a button taps it without anything extra. Native adapters listened for touches only: a SwiftUI or Compose target driven by `nudgPress`, or a React Native view with `bind().gesture`, couldn't be activated by VoiceOver or TalkBack at all, because those don't touch; they ask the element to activate.

- **Activation is the target's tap.** When the file handles `target.tap`, `nudgPress` adds an accessibility action (SwiftUI's default action, Compose's click action) and React Native's `gesture` the `activate` action, each sending the tap. A target whose tap the file doesn't handle gets nothing, so the adapters never claim an action they can't perform.
- **Only the action, not the semantics.** Role, label, value and state stay the host's (principle 13): the adapter adds no traits. A host that already makes the view a button keeps working; its own action and the adapter's are the same tap.
- **Reduced motion is the system's, on every platform.** Compose read no setting; it now follows "Remove animations" (an animator duration scale of 0), as SwiftUI follows Reduce Motion and React Native and the web their own settings. Each adapter reads it when the player is created; a change while a player runs applies to the next one (see the open questions).

## Open questions

These are unresolved design choices. Scheduling and completion status live in the [roadmap](roadmap.md); examples of possible syntax below are proposals.

- Transitions that cross machine levels (to a parent's sibling, into a nested state).
- A final state in the grammar (`"final": true`, as in statecharts) to say "this state means the component is gone". Today the host names exit states in the adapter options (`exit: "hidden"`), because mounting and unmounting are the host's lifecycle; a file-level marker would let the tools (`observe`, the guide) know it too.
- Layout: formats 0.4, 0.6 and 0.9 implement measurement, arithmetic and measured follow/map endpoints. Measuring across players remains open.
- Pattern metadata currently lives in the versioned external recipe catalog. Revisit a file-level role such as `"role": "bottom-sheet"` only if generation or validation needs cannot be met without changing runtime documents.
- Pattern aliases and locale: how to map common design words such as FAB, snackbar, toast, tabs, tab bar, bottom nav, GNB, LNB and side nav without making the core format depend on one design system's names.
- Reduced motion that changes while a player runs. Adapters read the system setting when the player is created; switching mid-session would need the runtime to change its motion source without a jump, in every runtime.
- Reduced motion inside the format: a way for a file to say which properties must not be reduced (a progress bar's width), beyond the runtime's blanket option and 1.1's opacity loops.
- Discrete steps for `commit` (a slider that snaps to 10s), beyond `min`/`max`.
- Nonlinear rubber banding that depends on the view's size, instead of the linear `overdrag` factor.
- Loops that run a fixed number of times, and loops on colors; see [loops](#loops-while-a-state-is-active-format-010) for what 0.10 settled.
- `nearest` limited to neighbors of the current state (a carousel that moves one slide per swipe however hard the flick), instead of tuning `momentum` down.
- Gestures with three or more pointers, and a pinch's midpoint on SwiftUI.
- Continuous app inputs and scroll position are implemented in format 0.5. Still open: portable direction and velocity derivation, including thresholds and how those become deterministic events.
- DOM CSS-variable output: whether an optional adapter mode should write custom properties so host CSS composes transforms and visual properties, rather than writing final inline properties. This stays an adapter concern and needs real Tailwind/design-system cases before it displaces the direct, low-overhead default.
- A `sequence` combinator beyond per-property delays (0.12), if a pattern needs steps that wait on each other's completion rather than on time.
- Tweaking a named motion at the point of use, for example `{ "use": "snappy", "duration": 0.5 }`.
- Schemes: which names a scheme may supply or override, how the host passes one in, and how the validator still catches misspelled names. The built-in Apple-like and Material-like libraries.
