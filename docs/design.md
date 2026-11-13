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

**Tools.** `simulate`, `plot`, `compare` and the conformance suite take a layout table (`--layout seg2.x=72,seg2.width=88`, or `layout` in the MCP tools); `render` and `observe` measure the real page, and `compare` with a page (`url` or `html`) measures there the sizes the table doesn't give. The validator checks the target exists, the measurement name, and that `x`/`y` only measure into position properties.

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

## Web apps compile at build time

A first run from an empty Vite project measured nudg at about 28 kB gzipped for one press preset; 51 kB of its 87 kB minified was the compiler and validator, bundled because the web adapters compile documents in the browser. Native apps never paid this: they ship compiled programs.

- **The bundler compiles, as on native.** `nudg()` from `@nudg/core/vite` turns a `.nudg.json` import into the compiled program, so errors fail the build where the developer looks, and the browser gets data, not a compiler.
- **One seam.** Every adapter reaches the compiler through `core/to-program`; the plugin resolves that one module to a version without the compiler. The adapters' API doesn't change, and without the plugin nothing changes at all.
- **Presets stay one line.** They are documents built at run time from options, so they can't be compiled at build time. A small converter reads exactly the part of the format presets use; a test holds it to the compiler's output, program for program, across their options. Anything outside that part throws and names the way back: `nudg({ compiler: true })`.
- **Measured:** nudg in a React app went from about 28 kB to 14 kB gzipped with a file or a preset; the build of a file with an unknown event fails with `unknown-event` and its pointer.

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
- **Adjusting is the arrow keys.** When the file steps a target with arrow keys (a slider, a stepper), VoiceOver's swipe up and down (`nudgKeys`, which makes the view adjustable, as iOS requires for those gestures), TalkBack's Increase and Decrease actions, and React Native's `increment` and `decrement` send them: increment is arrowright or else arrowup, decrement arrowleft or else arrowdown, the keys a slider takes on the web.
- **Only the action, not the semantics.** Role, label, value and state stay the host's (principle 13): the adapter adds no traits. A host that already makes the view a button keeps working; its own action and the adapter's are the same tap.
- **Reduced motion is the system's, on every platform.** Compose read no setting; it now follows "Remove animations" (an animator duration scale of 0), as SwiftUI follows Reduce Motion and React Native and the web their own settings. Every adapter follows it as it changes, through the runtime's `setReducedMotion` (see [Reduced motion keeps fades](#reduced-motion-keeps-fades-format-11) and the spec).

## Players that share an element, and a stagger from the host's index

Status: decided 2026-11-09. Composition is implemented, as the default in the DOM adapter and as `compose()` on React Native. The delay that reads an input is implemented as format 1.2. PlaySnack's first day of whole-app use ([devlog](devlog.md#2026-11-05-what-playsnacks-first-day-found)) hit three limits that are one question: what happens when more than one thing moves the same element.

- [#122](https://github.com/seukwoo/nudg/issues/122): the shared press file and a list's rise-in can't both play on one card. Each DOM player writes the whole `transform`, so the last writer wins.
- [#125](https://github.com/seukwoo/nudg/issues/125): an element placed by its own transform (a badge centred with `translate(-50%, -50%)`, a rotated sticker) loses its placement when a player binds it, so PlaySnack skips such elements and they don't press.
- [#124](https://github.com/seukwoo/nudg/issues/124): cards rising one after another need a delay per index; today that means one generated document per card and a timer per tag.

**What the platforms already do.** SwiftUI and Compose don't have the first two problems. Two `.nudg` modifiers on one view stack like any modifiers: the offsets and rotations compose, the scales and opacities multiply, and the view's own modifiers stay where the author put them. The DOM adapter writes final inline properties, and React Native's style arrays let a later `transform` replace an earlier one. So #122 and #125 are adapter gaps on two platforms, not a missing idea in the format.

### Decided: compose on the element, like modifiers (#122, #125)

- **Each element has one composer, shared by the players bound to it.** (Also, a root element another player already marked with the same `data-nudg` name now binds by that name.) A DOM player hands its target's values to the element's composer instead of writing `style.transform` itself, and the composer writes once per frame.
- **The author's transform is the outermost layer.** The element's own transform at bind time (inline, or from a stylesheet) stays first in the composed `transform`, and each player's `translate() rotate() scale()` follows it, in bind order. A badge centred with `translate(-50%, -50%)` therefore presses about its own centre. The composer restores the element's own transform when the last player lets go. (This builds on #121's restore.)
- **Opacity multiplies, as nested views' opacity does. Size and color can't be combined:** a second player writing the same one is an error the adapter reports once, naming both files; the last writer keeps it.
- **React Native gets a helper, not a rule change:** `compose(a.bind("card"), b.bind("button"))` returns one style, with the transform arrays concatenated and the opacities multiplied with `Animated.multiply`.
- **The format doesn't change.** The runtimes and conformance cases stay as they are. The adapter tests define the composition order.

**Considered: a file that mounts another as a region** (`"regions": { "press": { "use": "./press.nudg.json", "targets": { "button": "card" } } }`).
- It is one player and one runtime, and the validator could see two regions writing the same property.
- But it is a format change in three runtimes. The file would need to rename targets and namespace events, and it would only cover files written together. The press file and the list file come from different places in an app and bind at different times (the press on any button, on pointer down).
- Kept in reserve, for when a single file genuinely needs to own both motions.

### Decided: a delay that reads an input (#124)

- **The rhythm stays in the file and the index stays in the host**, as for lists (0.17) and per-property delays (0.12): `"animate": { "card.y": { "spring": { "duration": 0.3 }, "delay": { "input": "host.index", "times": 0.06 } } }`.
- **Each card's player gets its index** (`inputs: { "host.index": 2 }`), and one `host.show` per player starts them all. The cards rise 0.06 s apart.
- **A tag inside a card adds its own index:** `{ "input": "host.index", "times": 0.06, "plus": 0.15 }` plus a second input for the tag's position. Arithmetic is the same `times` / `plus` that measurements use (0.6).
- **A ceiling** (`"max": 0.5`) keeps a long list from waiting seconds for its last row.
- **Reduced motion ignores delays, as it already does.**
- **What it costs:** a format version, the validator, conformance cases and the three runtimes. A delay that reads an input is new, but its evaluation is the 0.6 measure arithmetic over an input.
- **Not chosen: one player driving many elements with a per-element time offset.** It reads as one call, but each card's press and hover are its own states. Those still need a player per card, so an offset that applies to every element at once only fits lists whose elements never differ, and it bends 0.17's one-player-per-item rule.

**Decided:**
- **Composition is the default, with no option to turn it off.** Before, the last writer won and a motion disappeared; nobody depends on that.
- **The delay input ships in format 1.2.** PlaySnack already works around it with a document per card and a timer per tag.

## Nothing around nudg: host glue, and an agent that finds what exists

Status: decided 2026-11-10, with the recommended choices below; being implemented in order (agent guidance first). PlaySnack drives every shell interaction with nudg, and still keeps 731 lines of motion glue and CSS keyframes on seven screens ([devlog](devlog.md#2026-11-10-what-playsnack-wrote-around-nudg)). Two kinds of gap produced them.

- **nudg lacked the feature.** Examples: a player that lets go by itself; binding every button. These need new adapter API.
- **nudg had the feature, and the agent never found it.** Examples: `nudgTransition`; `onExit` and `present` for close-then-unmount; reduced motion that is already automatic. The agent skill teaches the file loop (edit, compare, judge) and says nothing about the host side, so the agent wired nudg the way it would wire any library: with its own timers and wrappers.

Glue that duplicates nudg is a maintenance cost the person pays, and it hides motion from the tools (compare, critique, observe). The goal: an app's motion is nudg files plus adapter calls, and an agent that builds with nudg reaches for those first.

None of this changes the format. Every item is adapter API or agent tooling, so the runtimes and conformance cases stay as they are.

### Decided: adapter features, in order of the glue they remove

1. **A player that lets go by itself.**
   - API: `playDoc(file, el, { start: "host.go", release: "settle" | "exit" })`.
   - `start` sends an event right after binding.
   - `release` destroys the player at its first rest (or exit) after something moved, which restores the element's own styles.
   - This is a shake, a success pop, a burst piece: one call, no `letGo`, no timers.
   - A `player.done` promise resolves when it lets go, for hosts that clean up a container.
2. **Close, then unmount, as one thing.**
   - The React hook (and the DOM player) gain `leaving`: in an exit state and still moving.
   - Today a host must derive this to let taps through a leaving dim.
   - Everything else in PlaySnack's 78-line closer already exists or was #133:
     - `send("host.hide")`, then the parent unmounts in `onExit`;
     - a show during the way out cancels the exit (`present` returns to true);
     - reduced motion exits at once;
     - a hidden tab now ends.
   - This item is therefore mostly guidance (see below), plus one flag.
3. **One file on every element that matches.**
   - API: `playEach(file, selector, { root, when: "press" | "mount" })`.
   - `press` binds a player when a pointer lands, in the capture phase, so the press shows on that very touch.
   - `mount` binds elements as they appear, through a MutationObserver.
   - Players whose elements leave the page are destroyed.
   - It skips disabled controls and `[data-nudg-off]`.
   - Composition (1.6) makes the old skips (another player moves it, it has its own transform) unnecessary.
4. **One-off entrances cheaper than a CSS line.**
   - API: `useNudgOnce(file, { replay: [deps] })` in React returns a ref. The element plays the file's way in on mount, plays it again when a dependency changes (a countdown's number), and lets go at rest.
   - On the DOM, the same is item 1 with `start: "host.show"`.
   - Presets for the shapes PlaySnack hand-wrote as keyframes: `pop` (scale and fade in with overshoot), `drop` (falls in, squashes, settles), `shake`.
   - With these, a trophy drop is `useNudgOnce(presets.drop())`. It honours reduced motion and shows in compare, which the CSS line never did.
5. **Particles ([#118](https://github.com/seukwoo/nudg/issues/118)).**
   - This one is a format question: many pieces from one file, each with its own direction.
   - It is kept separate, and decided after 1 to 4 show how much of the burst is left.

### Decided: an agent that finds what exists

1. **The skill and the guide cover the host side.**
   - A short "wire without glue" table maps what an app needs to the API that does it:
     - unmount after the way out: `exit` and `onExit` / `present`;
     - a library's overlay: `nudgTransition`;
     - a one-shot: `release`;
     - every button: `playEach`;
     - a stagger: `delay.input`;
     - two motions on one element: they compose;
     - reduced motion: already followed.
   - Rules:
     - never time motion with `setTimeout`, use `onSettle` / `onExit`;
     - never write `transform` or `opacity` on a bound element;
     - never add CSS keyframes or transitions for something a preset or recipe covers.
2. **`nudg audit` (CLI and MCP `nudg_audit`).**
   - It scans a project for motion that lives outside nudg:
     - CSS `@keyframes`, `animation` and `transition` on transform or opacity;
     - `element.animate`;
     - other motion libraries;
     - `requestAnimationFrame` loops;
     - timers around a player's `send` or `destroy`;
     - style writes to bound elements.
   - Each finding names the nudg equivalent: a preset, a recipe, or an adapter call.
   - A summary line gives the share of motion on nudg. "PlaySnack at 100%" then becomes a number the person and the agent can both see.
   - The skill tells the agent to run it after wiring nudg into an app.
3. **Warnings where the glue happens.**
   - The DOM adapter warns once when a bound element also has a CSS transition or animation on a property the file writes.
   - `observe` already detects this after the fact; the warning catches it while the agent is still working.

### Choices (decided as proposed)

- `release` on the existing `playDoc`, or a separate `playOnce`? Proposed: an option, so one function stays the way in.
- `useNudgOnce` replaying on dependencies, or a `key` the host changes (React's own way to restart)? Proposed: `replay`, because a key remounts the element and loses its focus and DOM state.
- `audit` heuristics will miss things and flag some CSS that is fine (a colour hover). Proposed: report, never fail, and let `// nudg-audit-ignore` mark the deliberate ones.

## Format 1.3: feedback beyond motion

Status: decided 2026-11-11 with the proposed choices; shipping one at a time. Shadow, blur, custom properties and cues are implemented as format 1.3; particles as format 1.4. Interaction feedback is motion, sound and touch landing on the same moment, plus the effects motion alone can't draw. Today a nudg app does the rest itself:
- PlaySnack keeps about 800 lines for sound and haptics (`sfx.ts`, `tapSound.ts`, `moments.ts`, `gameCues.ts`), and much of that only times them against the motion;
- it draws confetti with `element.animate`, one call per piece (#118);
- it animates `box-shadow` with CSS keyframes, which `nudg audit` can only call a gap.

Four additions share one aim: the file says what happens and when, the runtime decides the exact moment, and the adapter does it on each platform. For what nudg can't do on a platform there is one narrow way out, so nobody needs to leave the format for it.

### Decided: cues, for sound and haptics

A **cue** is a named moment the runtime reports at an exact time. The file holds only names and numbers, never sound files or vibration patterns.

```json
"when": { "track.tap": { "to": "on", "cue": "toggle" } },
"states": {
  "won":     { "cue": { "sound": "win", "haptic": "success" } },
  "invalid": { "enter": { "field.x": { "keyframes": [
    { "at": 0.16, "value": -10, "cue": "tick" },
    { "at": 0.58, "value": -6,  "cue": { "haptic": "tick", "intensity": 0.5 } }
  ], "duration": 0.42 } } }
}
```

- **Where a cue can sit.**
  - On a transition: it fires when the transition fires.
  - On a state: on entering it.
  - On a keyframe or loop frame: on that beat, and on every cycle of a loop.
  - `{ "arrive": "card.y" }`: when that property's motion first reaches its target. That is the landing of a drop, before the overshoot settles.
  - `{ "every": 10, "of": "slider.value" }`: each time a value crosses a step. These are the detents of a slider or a picker.
- **What a cue carries.**
  - `sound` and `haptic` names; a string is shorthand for both.
  - `intensity`, from 0 to 1.
  - `pitch`, in semitones, for a combo that climbs.
  - `delay`, in the same forms as motion delay: a number, or `{ input, times, plus, max }`, so a stagger ticks with its items.
  - `repeat` (`{ "count", "every" }`).
  - `throttle`: a minimum gap, so a fast drag doesn't fire 60 times a second.
  - Any number can be `{ "input": … }`, so a rubber band can pull harder the further it goes.
- **Haptics are intent names, as every platform now does:** `tick`, `select`, `light`, `medium`, `heavy`, `soft`, `rigid`, `success`, `warning`, `error`, `align`, `edge`. The adapters map them:

  | name | iOS | Android | Windows (InputHapticsManager) | Web |
  |---|---|---|---|---|
  | tick / select | UISelectionFeedbackGenerator | `SEGMENT_TICK` / `CLOCK_TICK` | Step | `tick` (proposed Web Haptics), else a 10 ms `vibrate` |
  | light, medium, heavy, soft, rigid | UIImpactFeedbackGenerator styles | VibrationEffect primitives (`TICK`, `CLICK`, `THUD`), scaled by intensity | Collide | `hint`, else `vibrate` |
  | success, warning, error | UINotificationFeedbackGenerator | `CONFIRM` / `REJECT` | Success | `vibrate` pattern |
  | align, edge | Selection | `SEGMENT_FREQUENT_TICK` | Align | `align` / `edge` |

- **Sounds are the host's:** `nudg({ sounds: { win: "/sfx/win.mp3" } })` on the web. A native adapter takes a name-to-resource map. Volume, mixing and preloading stay the app's.
- **Settings.**
  - Haptics follow the system's haptics setting.
  - Sounds follow `sound: false` (an app's mute).
  - Under reduced motion, cues still fire, because they aren't motion. Cues on beats that reduced motion skips fire once, when their state is entered.
- **The runtime reports cues as time-stamped events** (`runtime.cues(from, to)`), deterministic like everything else. Conformance cases list them, and `simulate`, `plot` and `compare` show them on the timeline.

### Decided: particles (#118)

An **emitter** sends out many short-lived pieces from one place, in one file. Each piece follows a closed-form path: a launch velocity, linear drag, gravity, spin, and a fade near the end of its life. So any time can be sampled exactly, and a seed makes every burst reproducible.

```json
"targets": ["button", "confetti"],
"emitters": { "confetti": { "from": "button", "count": 24, "angle": [-150, -30], "speed": [500, 900],
  "gravity": 1600, "drag": 1.2, "spin": [-720, 720], "life": [0.9, 1.3], "fade": 0.3, "scale": [0.6, 1] } },
"when": { "host.celebrate": { "emit": "confetti" } }
```

- **Sources:**
  - `from` a target's centre (a burst);
  - `from` its bounds;
  - `"from": "top"`, the top edge of the bound container (rain);
  - `around` a target (a sparkle).
- **Each piece's numbers** come from its index and the emitter's `seed`, never from `Math.random`, so `simulate` and `compare` stay exact. A second `emit` while pieces are flying adds another wave with the next seed.
- **What the host draws.** Pieces are drawn from templates the host gives:
  - on the web, children of the emitter's element marked `data-nudg-piece`, cloned and cycled;
  - natively, a view builder that receives the index;
  - on a canvas, the headless player's `pieces(emitter)` with each piece's x, y, rotation, scale and opacity.

  Colors and shapes are the template's, so a file stays brand-free.
- **Lifecycle:** pieces count as moving until their life ends, so `onSettle` comes after the last one has faded. The adapter removes them; the host keeps nothing.
- **Reduced motion:** nothing is emitted. A file can name a cue or a state for the moment instead (a soft pop).
- **Budget:** `critique` warns past 60 pieces in a wave or 2 s of life. Only transform and opacity move.
- **Recipes and presets:** `confetti-burst`, `confetti-rain` and `sparkle` get starters.

### Decided: shadow and blur

| property | web | SwiftUI | Compose | React Native |
|---|---|---|---|---|
| `shadowX`, `shadowY`, `shadowBlur` (numbers), `shadowColor` (color with alpha) | `box-shadow` | `.shadow(color:radius:x:y:)` (radius = blur / 2) | `Modifier.dropShadow` (Compose 1.9) | `boxShadow` (0.76+) |
| `blur` (number) | `filter: blur()` | `.blur(radius:)` | `Modifier.blur` (Android 12+) | `filter` where supported |

- **Four plain properties, not one compound value.** Each has its own motion, like `x` and `y`. A lift deepens its shadow with the same spring that raises the card.
- **No spread.** SwiftUI and Compose shadows have none. A ring that spreads is a separate element that scales up as it fades, which also runs on the GPU.
- **Where a platform can't draw it** (blur below Android 12, some React Native versions), the adapter warns once and skips it, and the rest of the file plays.
- **Gradients wait.** They don't interpolate in CSS, and the common cases (a shimmer, a color shift) are an overlay that moves or two layers that cross-fade. Stops as color properties come when a real case can't be done that way.

### Decided: one narrow way out (custom properties and cues)

For what nudg doesn't cover on some platform (a shader, a platform-only material, a Lottie frame), the way out carries values and moments, never timing logic. The motion stays in the file and the tools keep seeing it.

- **Custom properties.**
  - `"card.custom.glow": 0` is a number the file moves like any other: spring, delay, stagger, reduced motion, settle.
  - The host only draws it. On the web it is also written as a CSS variable on the element (`--nudg-glow`), so `box-shadow: 0 0 calc(var(--nudg-glow) * 20px) gold` needs no script.
  - Natively it is in the model's values.
- **Custom cues:** a sound or haptic name that isn't built in reaches `onCue(name, { intensity, pitch })`, at the exact moment.
- **Guardrails, so the way out doesn't become the way in:**
  - custom names must be declared under `host.custom`, so the file stays closed;
  - a custom name that matches a built-in property or haptic is an error whose hint names the built-in;
  - `audit` counts custom uses next to the share on nudg;
  - the skill tells the agent to look for the built-in first, and to tell the person why when it reaches for a custom one;
  - the custom names that keep appearing in shared reports are the queue for the next built-ins.

### What it costs, and in what order

- **Shadow and blur:** a vocabulary entry and an adapter mapping each; the runtimes already move numbers and colors. Cheapest.
- **Cues:** a field on transitions, states and frames; `runtime.cues(from, to)` in three runtimes; conformance cases with cue times; haptics in five adapters; sounds through host maps.
- **Particles:** the emitter model and its closed-form path in three runtimes, conformance by sampled pieces, piece rendering in five adapters, and three recipes.
- **The way out:** a property namespace, a host declaration, the CSS variable, `onCue`.

Proposed order: shadow and blur with custom properties, then cues, then particles. They ship together as format 1.3, or as 1.3, 1.4 and 1.5 if one is ready well before the others.

### Choices (decided as proposed)

- **A cue string as shorthand for both sound and haptic, or sound only?** Proposed: both. A built-in haptic name plays its haptic, and every name reaches the sound map and `onCue`.
- **Particles as a top-level `emitters` block, or as a target kind?** Proposed: `emitters`, because a piece isn't a target the host binds one by one.
- **Releases:** one format version for all four, or one each? Proposed: one each, in the order above, each as soon as it is ready.

## Proposal: CSS keyframes in, a nudg file out

Status: decided 2026-11-12 and implemented: format 1.5 ([#152](https://github.com/seukwoo/nudg/pull/152)) and `nudg from-css`. With [#150](https://github.com/seukwoo/nudg/pull/150), `nudg audit` puts PlaySnack at 45%: 40 motions on nudg, 48 outside. All 48 are things nudg already does, and 37 of them are CSS `@keyframes`. The audit says to rewrite each one as entry keyframes, and an agent rewriting 37 of them by hand reads percentages, transform lists and timing lines, and gets some of them subtly wrong without anyone seeing it. The conversion is mechanical, so a tool should do it and show that the result matches.

### What it does

- **Input.**
  - The input is a source file and a keyframes name: `nudg from-css src/Ceremony.tsx snkPop`. It may also be a CSS snippet.
  - The source may be a `.css` file or a CSS-in-JS template string, as PlaySnack's are. A `${...}` interpolation in a value is reported, never guessed.
  - The tool finds the `animation` line that uses the name in the same source and reads its duration, timing function, delay, iteration count, direction and fill mode from it. A flag supplies any of them that it can't find.
- **Output.**
  - It writes a nudg file in the shape of the presets: a `hidden` state holding the 0% values, and a `shown` state holding the 100% values, with `enter` keyframes for every frame in between. `host.show` goes from `hidden` to `shown`.
  - `useNudgOnce(file)` or `playDoc(file, el, { start: "host.show", release: "settle" })` then plays it.
  - It maps the CSS to nudg properties:
    - `translateX` / `translateY` become `x` / `y`;
    - `scale` becomes `scale`, or `scaleX` / `scaleY`;
    - `rotate` becomes `rotation`;
    - `opacity`, `background-color`, `box-shadow` and `filter: blur()` map to their 1.3 properties.
  - It maps the timing:
    - **Held frames** (`20%, 70% { ... }`): two frames with the same value.
    - **`transform: none`**: the identity values.
    - **A property missing from some frames**: CSS interpolates it between the frames that name it, so the tool keeps only the frames that name it.
    - **A delay**: the tool adds a hold at the start.
    - **`infinite`**: a loop in a state, not an entry.
    - **`alternate`**: a loop cycle out and back.
    - **A name that ends hidden** (`to { opacity: 0 }`): an exit state.
  - Several animations on one element become one file. Ceremony's `snkNum` with `snkNumFade` is one example; one entry per property, each with its own length.
- **Proof.**
  - The tool samples the CSS animation and the nudg program at 60 points and prints the largest difference for each property. It computes CSS interpolation itself: linear between frames, with the frame's timing function.
  - Above a set limit (0.5 px, 0.5°, 0.01 of scale or opacity), it doesn't write the file. Instead it names the frame and the reason.
- **Where.**
  - The converter is a pure function in `src/core` (text in, document and report out), so it can also run in a browser.
  - It is available as the `nudg from-css` CLI command and as the MCP tool `nudg_from_css`.
  - The audit's hint for a convertible `@keyframes` becomes the exact command to run.

### What the format gains for it (1.5)

Two things CSS keyframes do that nudg entry keyframes can't yet. The converter mustn't approximate them, so the format gains them. A tool that rounds a slide-in off isn't one people can trust.

- **Values measured from the element's size in entry keyframes.**
  - Loop frames already accept `{ "of": "height", "times": -0.7 }`; entry keyframes take only numbers.
  - A slide from off screen is `translateX(-100%)`, and it is common. PlaySnack has it in:
    - `snkLnbIn` and `snkSetUp`;
    - `snkRoll` (a share of its height);
    - `golfCheerT`.
  - This needs conformance cases in all three runtimes, as for loops.
- **An ease per frame.**
  - CSS lets each frame set the timing of the leg after it (`animation-timing-function` inside a frame). A bounce is written that way: ease-in falling, ease-out rising.
  - nudg keyframes have one ease for every leg. A frame gains its own `ease`, which overrides the effect's ease for its leg.

A constant offset is not motion: `golfCheerT` keeps `translateX(-50%)` in every frame to center the element. The converter moves it to the element's base value and says so.

### What it still reports instead of converting

- `steps()`: discrete jumps, a different kind of motion (sprite sheets). nudg has none.
- Transforms in a different order from nudg's fixed one (a translate after a rotate or scale): the same numbers mean a different path.
- Properties nudg has no property for. The audit already points to a custom property.
- A `box-shadow` spread or `inset`.
- `${...}` interpolations, whose value only the app knows.

### Choices

- **A converter, or better hints only?** Proposed: a converter. A hint still leaves the hand rewrite, where the mistakes happen. The proof is what lets the person accept 37 files without opening each one.
- **Close enough, or exact?** Proposed: the file is written only within the limits above, and the report always says how close it is. A converter that quietly approximates would move motion into nudg, but it would change the motion.
- **Format changes:** measured values and a per-frame ease, in format 1.5 (decided 2026-11-12: if the converter needs them, the format gains them properly).
- **Spring fitting** (decided 2026-11-12: offer it, and ask).
  - **When it applies:** keyframes that overshoot and settle, like `snkPop` (1, 1.32, 0.94, 1.06, 1). A spring makes that shape by itself, and it carries on naturally when interrupted.
  - **What the tool returns:** the exact conversion, and next to it a spring version with its fitted stiffness and damping, plus how far it strays from the CSS.
  - **Who chooses:** the person, never the tool.
    - The CLI asks which one to write. `--spring` or `--exact` answers in advance.
    - The MCP tool returns both, and its instructions tell the agent to show the choice and ask.
    - Whichever is written, the report says that the spring version moves differently from the original.

## Proposal: shadow spread and inner shadows (format 1.6)

Status: decided 2026-11-13 as proposed. After [#156](https://github.com/seukwoo/nudg/pull/156), `nudg from-css` converts 39 of PlaySnack's 42 `@keyframes`. Two of the three left draw something nudg's shadow can't: `snkPopRing` grows a ring with a shadow **spread** (`0 0 0 12px`), and `snkPopFade` flashes an **inset** outline (`inset 0 0 0 2px`). Both are common: a focus ring, a pulse around a button, a pressed-in look. Today the workaround is a separate ring element, which is glue nudg exists to remove.

### What each platform draws

| Platform | Spread | Inner shadow |
|---|---|---|
| Web | `box-shadow` spread | `box-shadow: inset` |
| React Native 0.76+ | `boxShadow` with spread | `boxShadow` with `inset` |
| Compose 1.9+ | `Modifier.dropShadow(shape, Shadow(spread = …))` | `Modifier.innerShadow(shape, Shadow(…))` |
| SwiftUI | no spread: the adapter draws the shadow from a shape grown by the spread | `.shadow(.inner(color:radius:x:y:))` on a shape style (iOS 16+) |

React Native before 0.76 (the old architecture) has neither. There the adapter skips them with a warning, as it already does for a shadow it can't draw.

### Proposed

- **`shadowSpread`:** a length, default 0, beside `shadowX`, `shadowY`, `shadowBlur` and `shadowColor`.
- **An inner shadow as its own set:** `innerX`, `innerY`, `innerBlur`, `innerSpread` and `innerColor`. It is a second shadow, not a flag, so one element can have both (a lifted card with a pressed edge), and each animates on its own.
- **Runtimes:** both are ordinary numbers and colors there, so the conformance work is a case like `shadow-blur-custom`. The work is in the adapters.
- **`from-css`:**
  - reads a spread and one `inset` shadow;
  - converts a list of two shadows (one outer, one inset);
  - still refuses more than one of each.

### Not proposed

- **Skew** (`snkTrophyDrop` leans 1.6 px). Compose's `graphicsLayer` and SwiftUI's modifiers have no skew, so it would be a property that two platforms draw through a raw matrix. The converter's message already says how to change the CSS: scale after the rotate. Revisit it if a real design needs a skew.

### Choices

- **Inner shadow as properties, or as `inset: true` on the one shadow?** Proposed: properties. One shadow with a flag can't be both at once, and a flag can't animate.
- **SwiftUI spread by growing the shape?** Proposed: yes. It draws what the web draws, and the conformance values are the same; the drawing is the adapter's job.

## Open questions

These are unresolved design choices. Scheduling and completion status live in the [roadmap](roadmap.md); examples of possible syntax below are proposals.

- Transitions that cross machine levels (to a parent's sibling, into a nested state).
- A final state in the grammar (`"final": true`, as in statecharts) to say "this state means the component is gone". Today the host names exit states in the adapter options (`exit: "hidden"`), because mounting and unmounting are the host's lifecycle; a file-level marker would let the tools (`observe`, the guide) know it too.
- Layout: formats 0.4, 0.6 and 0.9 implement measurement, arithmetic and measured follow/map endpoints. Measuring across players remains open.
- An event that arrives before the first measurement. The DOM adapter measures a target as it is bound, so a sheet opened on mount rises from its measured height ([#120](https://github.com/seukwoo/nudg/issues/120)). React Native, SwiftUI and Compose report sizes after their first layout pass, so the same event there moves toward an end computed from a size of 0, and then retargets when the size arrives. Two fixes are possible: the runtime holds events whose targets read unmeasured values until those values are reported (deterministic and the same in every runtime, but a new rule in the conformance cases), or each native adapter defers the host's events until its first layout (local to each adapter, but three implementations). Decide when a native app opens something on mount.
- Pattern metadata currently lives in the versioned external recipe catalog. Revisit a file-level role such as `"role": "bottom-sheet"` only if generation or validation needs cannot be met without changing runtime documents.
- Pattern aliases and locale: how to map common design words such as FAB, snackbar, toast, tabs, tab bar, bottom nav, GNB, LNB and side nav without making the core format depend on one design system's names.
- Reduced motion inside the format: a way for a file to say which properties must not be reduced (a progress bar's width), beyond the runtime's blanket option and 1.1's opacity loops.
- Properties beyond transform, opacity, size and background color: shadow and blur are proposed in [Format 1.3](#format-13-feedback-beyond-motion); gradients and border color remain open.
- Discrete steps for `commit` (a slider that snaps to 10s), beyond `min`/`max`.
- Nonlinear rubber banding that depends on the view's size, instead of the linear `overdrag` factor.
- Loops that run a fixed number of times, and loops on colors; see [loops](#loops-while-a-state-is-active-format-010) for what 0.10 settled.
- `nearest` limited to neighbors of the current state (a carousel that moves one slide per swipe however hard the flick), instead of tuning `momentum` down.
- Gestures with three or more pointers, and a pinch's midpoint on SwiftUI.
- Continuous app inputs and scroll position are implemented in format 0.5. Still open: portable direction and velocity derivation, including thresholds and how those become deterministic events.
- React Native's frame path. The hook computes every frame in JS and sets Animated values, as React Native's JS-driven Animated does. Measured on an idle machine with a release build (Android emulator, spinners looping, JS frames per second, 30 at most there): nudg now matches JS-driven Animated (20 views 30 and 30, 60 views 25.5 and 26.2, 150 views 6.3 and 8.2), after it stopped setting values that hadn't changed; the native driver held 30 at 150. So past a few dozen views looping at once, only work off the JS thread keeps up. Time-driven motion (loops, a transition's springs and tweens with no input to follow) could be handed to the native driver, if its springs can be made to match the runtime's exactly under conformance (a linear loop already can); Reanimated would run the runtime itself on the UI thread at the cost of a dependency. Decide when a real screen needs that many views moving at once.
- DOM CSS-variable output: whether an optional adapter mode should write custom properties so host CSS composes transforms and visual properties, rather than writing final inline properties. This stays an adapter concern and needs real Tailwind/design-system cases before it displaces the direct, low-overhead default.
- A `sequence` combinator beyond per-property delays (0.12), if a pattern needs steps that wait on each other's completion rather than on time.
- Sound and haptics as output. nudg would decide when and with what values, never play anything: decoding files, mixing, voice limits, audio sessions and vibration stay the host's, as a game that names a cue and lets its host choose the file already does. Two shapes: a cue the runtime sends the host on a transition, on settle or at a spring's overshoot peak, with a name and an intensity or pitch; and continuous values (gain, playback rate, pan) driven by springs, `map` and `follow` like any property, which the host copies to its audio nodes every frame (an engine that gets louder and higher the harder a throttle input is pressed; a fade in and out as a gain spring). The property vocabulary is visual today, so the second needs either audio properties or host-named outputs. Where it pays off is judging: a cue can be checked against the motion it belongs to (people notice sound more than about 45 ms ahead of the picture or about 125 ms behind it), so `compare` could say a change moved the thud away from the moment the sheet lands, and one file would keep sound, haptics and motion in step on web, iOS and Android. Haptics are curves too: Core Haptics plays events with intensity and sharpness over time, Android composes primitives (click, tick, thud) with amplitudes, and the web only has on/off durations, so a pattern written once (a tick per detent crossed, a buzz that follows a spring's envelope) would need a per-platform rendering and a fallback. Reduced motion has a counterpart (silent mode, repetition fatigue) that the format may need to say something about. What today's API already covers, and so what a first case would actually need:
  - **Cues on a state change work now.** Every adapter reports the state as it changes and the end of motion (`onSettle`), so a host can play a sound on entering `half` or when everything is at rest. What it can't get is a moment inside the motion: a sheet *lands* when it first reaches its resting point, well before the spring settles, and an impact sound on `onSettle` comes late by the length of the tail. Arrival, the overshoot peak and a value passing a detent are the missing moments.
  - **Those moments can be exact.** Crossings stayed on inputs because a property sampled at 60 or 120 Hz crosses at different frames ([format 0.15](#events-from-continuous-inputs-format-015)). A spring is solved in closed form, so its arrival and peak times are known exactly and are the same in every runtime, which is what conformance needs; a crossing of a tween or spring at a given value is solvable the same way.
  - **Continuous values work, unreadably.** A host can drive a gain from the `opacity` of a target that isn't on screen and read it every frame. It plays, but the validator, the guide and the person can't tell it is a sound; named non-visual outputs (`engine.gain`, `knob.haptic`) are the readable form, and they are a vocabulary decision for three runtimes.
  - **Judging is the reason to put it in the file.** If the host plays a cue on its own timer, nudg can't say a change moved it off the landing. With cues in the file, `compare` can report each cue's offset from its motion moment against the 45 ms and 125 ms limits.
  - The smallest first step is the missing moments, since a cue on a state already works and continuous output has a workaround. Decide its shape (an adapter callback, or cues named in the file) when an app needs a sound or haptic at a motion moment rather than at a state change.
- Tweaking a named motion at the point of use, for example `{ "use": "snappy", "duration": 0.5 }`.
- Schemes: which names a scheme may supply or override, how the host passes one in, and how the validator still catches misspelled names. The built-in Apple-like and Material-like libraries.
