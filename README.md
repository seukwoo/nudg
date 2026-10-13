# nudg

**The interaction format your AI can nudge.**

nudg is a plain-text format for UI interactions: states, the events that move between them, and the motion in between. It lives in your codebase next to your components. Your AI coding tool writes it, a validator checks it, and a runtime plays it on any platform.

> Status: early design. Nothing here is stable yet.

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

## Grammar (draft, v0.1)

Worked out by expressing a toggle. See [`examples/toggle.nudg.json`](examples/toggle.nudg.json) and, with a parallel press region, [`examples/toggle-press.nudg.json`](examples/toggle-press.nudg.json).

```json
{
  "nudg": "0.1",
  "targets": ["knob", "track"],
  "values": { "knob.x": 0, "track.color": "#D1D5DB" },
  "motion": {
    "knob.x": { "spring": { "duration": 0.35, "bounce": 0.25 } },
    "track.color": { "tween": { "duration": 0.2, "ease": "out" } }
  },
  "initial": "off",
  "states": {
    "off": { "when": { "track.tap": "on" } },
    "on": {
      "set": { "knob.x": 20, "track.color": "#4ADE80" },
      "when": { "track.tap": "off" }
    }
  }
}
```

### Syntax: plain JSON

A nudg file is strict JSON with the extension `.nudg.json`. Every platform already parses it, JSON Schema describes it, and LLMs write it reliably, so there is no parser to maintain and nothing new to learn. A friendlier syntax can be added later as sugar that compiles to the same model, but JSON stays the source of truth.

JSON has no comments. Instead, any object may carry a `note` string. Runtimes ignore it. Unlike a comment, a note survives tools rewriting the file, and an AI can read it as part of the data.

### Motion model: states say where, motion says how

States only declare target values. `motion` declares how each property travels to its target. When the target changes mid-flight (for example, a second tap while the knob is still moving), the value retargets from where it is and keeps its velocity. Interruption is correct by default instead of a special case.

A transition can override motion for itself:

```json
"track.tap": { "to": "off", "motion": { "knob.x": { "spring": { "duration": 0.3, "bounce": 0 } } } }
```

### Structure

- **Top level:** `nudg` (format version), `targets`, `values`, `motion`, and a machine.
- **Machine:** either `initial` + `states` (one active state at a time) or `regions` (named machines that all run in parallel).
- **State:** `set` (values while active), `when` (transitions), and optionally a nested machine. Machines and states share this shape at every depth, which covers composition (decision 2).
- **Transition:** `"event": "target-state"` or `"event": { "to": ..., "motion": ..., "note": ... }`. In v0.1 a transition targets a sibling state.

### Paths and events

- One dotted form everywhere: `target.property` for values (`knob.x`), `target.event` for events (`track.tap`). The same string appears in `values`, `set`, `motion`, and `when`, so it can be found and edited directly.
- Stage 0 pointer events: `down`, `up`, `cancel`, `tap`.
- Transitions live under `when`, not `on`, so they never collide with a state named `on`.

### Value resolution

1. Start from `values` (the base).
2. Apply `set` from every active state; a deeper state overrides its ancestors.
3. If two parallel regions set the same property, the validator reports an error.

### Motion primitives

- **`spring`:** `duration` (seconds, perceptual) and `bounce` (0 = no overshoot, toward 1 = more bounce; v0.1 range is 0 to <1). With mass 1, stiffness = (2π / duration)² and damping ratio = 1 − bounce. `stiffness` / `damping` / `mass` are accepted as an alternative form. The spec defines springs by their closed-form solution, so results are deterministic (decision 3).
- **`tween`:** `duration` and `ease`.

### Units

- Time: a bare number is seconds; `"350ms"` is also accepted.
- Length: a bare number is a logical unit (decision 7).

### Unknown fields and extensions

An unknown key without a prefix is a validator error with a "did you mean" hint, so typos are caught instead of silently ignored. Keys starting with `x-` are extensions; runtimes that don't understand them ignore them.

## Open questions

- Color interpolation space (likely OKLab).
- Exact easing vocabulary for `tween` (named curves, cubic Bézier).
- Transitions that cross machine levels (to a parent's sibling, into a nested state).
- Host-driven input: a controlled toggle whose state is set by the app (`checked` from props), and how app data events are named.
- Keyboard and accessibility events (`space`, `enter`, focus).
- Follow-style values: the knob tracking a drag, then springing to a state on release.
- Event ordering when one pointer gesture produces several events (`up` then `tap`).
- License.
