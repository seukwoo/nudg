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

### Where it starts: web UI micro-interactions

A micro-interaction is a small, self-contained UI moment with one job: trigger → rules (state) → feedback (motion). Examples:

- A like button whose heart pops when tapped
- A toggle whose knob springs across the track
- A button that sinks slightly while pressed
- An input that shakes on invalid entry
- Pull-to-refresh, swipe-to-delete
- A tab indicator that slides to the selected tab
- A toast that slides in and out

This is the first target because the gap is real: full animation tools are overkill here, and CSS alone gets messy once state is involved. It is also where people building with AI coding tools are the most numerous, and the pieces are small enough to polish to a high bar.

### Where it grows

The format is designed for the whole range from day one. Implementation starts at stage 0.

| Stage | Scope | Examples | Needs |
|---|---|---|---|
| 0 | Single element | Toggle, button, like | States, transitions, springs; DOM adapter |
| 1 | Component | Tabs, accordion, swipe row, carousel | Coordinating several targets, gestures; React adapter |
| 2 | Screens and flows | Onboarding, modals, screen transitions | Nested states, data inputs, composing machines |
| 3 | Native | iOS, Android | SwiftUI and Compose adapters, or code generation |
| 4 | Standalone content | Physics, canvas, game-like scenes | Own rendering, physics |

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

## Open questions

- Transitions that cross machine levels (to a parent's sibling, into a nested state).
- Layout (v0.4): measured positions and sizes (`{ "measure": "tab2.x" }` for a tab indicator), a natural size (`"auto"`) to collapse a row from, and `%` units.
- Decay (fling, inertia) as a motion of its own, for scroll-like content without snap points (v0.4). Snapping is covered by `nearest`.
- Reduced motion inside the format: a way for a file to say which properties must not be reduced (a progress bar's width), beyond the runtime's blanket option.
- Discrete steps for `commit` (a slider that snaps to 10s), beyond `min`/`max`.
- Nonlinear rubber banding that depends on the view's size, instead of the linear `overdrag` factor.
- Continuous motion while a state is active (a spinner turning, a marquee): a rate-driven value, and how it hands off when the state is left (a rotation at 720° shouldn't unwind to 0). Today this is left to CSS through `data-nudg-state`.
- `nearest` limited to neighbors of the current state (a carousel that moves one slide per swipe however hard the flick), instead of tuning `momentum` down.
- Pinch, rotate and other multi-pointer gestures.
- More primitives and combinators: `keyframes`, `sequence`, `delay`, `stagger`.
- Tweaking a named motion at the point of use, for example `{ "use": "snappy", "duration": 0.5 }`.
- Schemes: which names a scheme may supply or override, how the host passes one in, and how the validator still catches misspelled names. The built-in Apple-like and Material-like libraries.
