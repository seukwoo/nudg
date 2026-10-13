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

## How it works

nudg doesn't contain an AI. The AI coding tool you already use turns your words into edits; nudg makes those edits small, checkable, and safe.

1. **Your app imports the nudg runtime.** The interaction lives in a file next to the component, for example `toggle.nudg.json`. The component plays it and marks its parts by name (`data-nudg="knob"`).
2. **You ask for a change in plain words.** "Make the toggle a little bouncier." Your AI edits one field in the nudg file (`"bounce": 0.25` → `0.4`) and leaves the component code alone. The vocabulary is chosen so that everyday words map to single fields: bouncier is `bounce`, faster is `duration`.
3. **Your AI checks its own work** through the nudg CLI or MCP server: `validate` explains what's wrong and how to fix it, `simulate` sends events and reports values over time ("the knob now overshoots to 22.8"), and `render` draws any moment as an image.
4. **The runtime plays the file** in your app: the core computes values every frame, and a thin adapter applies them to your views.

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

Worked out by expressing a toggle and a like button. See [`examples/`](examples/).

```json
{
  "nudg": "0.1",
  "targets": ["knob", "track"],
  "values": { "knob.x": 0, "track.color": "#D1D5DB" },
  "animate": {
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

### Motion model

- **States say where.** A state only declares target values.
- **`animate` says how.** It maps each property to the motion that carries it to its target. When the target changes mid-flight (a second tap while the knob is still moving), the value retargets from where it is. A spring also keeps its velocity, so interruption is correct by default instead of a special case.
- **`enter` adds a moment.** Some feedback is transient: a heart that pops and settles back, a field that shakes. The target doesn't change, so `enter` plays a *kick* when a state is entered (see below).

A transition can override `animate` for itself:

```json
"track.tap": { "to": "off", "animate": { "knob.x": { "spring": { "duration": 0.3, "bounce": 0 } } } }
```

### Defining your own motion

Platform motion is not special in nudg. Motion is defined in three layers, and the same format is used at every layer:

1. **Primitives** (in the core, defined by the spec and checked by the conformance suite): `spring`, `tween`, and `kick`. The core stays small.
2. **Named motions:** a file's `motions` defines motions by name, and anywhere a motion is expected, a name can be used instead. `import` brings in the named motions of other files, so a design system keeps its signature motion in one library and every component follows it. "Make the whole app snappier" is a one-line diff in that library.
3. **Schemes:** a motion library the host chooses. Apple-like and Material-like feels ship as nudg libraries written in this same format, not as runtime code, so a team's own signature motion is a peer of the platform ones.

Identical motion on every platform is the default: explicit parameters and named motions mean the same values everywhere. A scheme is an explicit input, so the same events with the same scheme still produce the same values, and the conformance suite can test each scheme.

A library file has `motions` and no machine:

```json
{
  "nudg": "0.1",
  "motions": {
    "snappy": { "spring": { "duration": 0.3, "bounce": 0.15 } },
    "pop": { "kick": 6, "spring": { "duration": 0.4, "bounce": 0.5 } }
  }
}
```

A component imports it:

```json
{
  "nudg": "0.1",
  "import": ["./motion/brand.nudg.json"],
  "targets": ["heart"],
  "values": { "heart.scale": 1 },
  "animate": { "heart.scale": "snappy" },
  "initial": "idle",
  "states": {
    "idle": { "when": { "heart.tap": "liked" } },
    "liked": { "enter": { "heart.scale": "pop" }, "when": { "heart.tap": "idle" } }
  }
}
```

- `import` paths are relative to the importing file. Imports may chain; a cycle is an error. In v0.1 only `motions` are imported.
- A name defined twice (locally and in an import, or in two imports) is an error that names both sources. Use a new name instead of shadowing.

### Structure

- **Top level:** `nudg` (format version), `import`, `targets`, `values`, `motions`, `animate`, and a machine. A file without a machine is a library.
- **Machine:** either `initial` + `states` (one active state at a time) or `regions` (named machines that all run in parallel).
- **State:** `set` (values while active), `enter` (kicks played on entry), `when` (transitions), and optionally a nested machine. Machines and states share this shape at every depth, which covers composition (decision 2).
- **Transition:** `"event": "target-state"` or `"event": { "to": ..., "animate": ..., "note": ... }`. In v0.1 a transition targets a sibling state.

### Paths and events

- One dotted form everywhere: `target.property` for values (`knob.x`), `target.event` for events (`track.tap`). The same string appears in `values`, `set`, `animate`, `enter`, and `when`, so it can be found and edited directly.
- Stage 0 pointer events: `down`, `up`, `cancel`, `tap`. The host sends each as a separate event; a click is `down`, `up`, `tap`, in that order.
- Events are processed one at a time, in the order sent. Each event is offered to every active region, in the order the regions appear in the file.
- Transitions live under `when`, not `on`, so they never collide with a state named `on`.

### Value resolution

1. Start from `values` (the base). Every property used anywhere must have a base value.
2. Apply `set` from every active state; a deeper state overrides its ancestors.
3. If two parallel regions set the same property, the validator reports an error.

### Motion primitives

- **`spring`:** platforms offer many spring APIs, but they describe one physical model (mass, stiffness, damping) in different forms. nudg has one spring primitive and accepts the common forms:
  - `duration` + `bounce` (the default form). `duration` is perceptual, in seconds. `bounce` is 0 for no overshoot, toward 1 for more bounce, and negative for overdamped; it must be below 1. With mass 1, stiffness = (2π / duration)² and damping ratio = 1 − bounce.
  - `response` + `dampingFraction`, where response = duration and dampingFraction = 1 − bounce.
  - `stiffness` + `dampingRatio`, with mass 1.
  - `stiffness` + `damping` + `mass`.

  Every form converts exactly to stiffness, damping, and mass, which is what the spec computes with. A spring uses exactly one form; mixing them is a validator error. Fit-to-duration springs (a fixed total time plus a damping value) are not supported, because they don't map to a single physical spring. The spec defines springs by their closed-form solution, so results are deterministic (decision 3).
- **`tween`:** `duration` and `ease`. `ease` is `linear`, `in`, `out`, `in-out`, or a cubic Bézier `[x1, y1, x2, y2]`; the default is `in-out`. On retarget, a tween restarts from the current value with its full duration.
- **`kick`:** adds velocity (units per second) to a numeric property without changing its target, then lets the motion's `spring` carry it back. A kick always comes with a `spring`. A positive kick on `scale` is a pop; a negative kick on `x` with a high bounce is a shake.

### Colors

Colors are hex strings (`#RGB`, `#RRGGBB`, `#RRGGBBAA`) and interpolate in OKLab, which keeps midpoints from going muddy. A color can be tweened or sprung; a kick on a color is an error.

### Units

- Time: a bare number is seconds; `"350ms"` is also accepted.
- Length: a bare number is a logical unit (decision 7).

### Unknown fields and extensions

An unknown key without a prefix is a validator error with a "did you mean" hint, so typos are caught instead of silently ignored. Keys starting with `x-` are extensions; runtimes that don't understand them ignore them.

## Open questions

- Transitions that cross machine levels (to a parent's sibling, into a nested state).
- Host-driven input: a controlled toggle whose state is set by the app (`checked` from props), and how app data events are named.
- Keyboard and accessibility events (`space`, `enter`, focus).
- Follow-style values: the knob tracking a drag, then springing to a state on release.
- Decay (fling, inertia) as a second physics primitive alongside spring, needed for swipe and scroll-like motion at stage 1.
- More primitives and combinators: `keyframes`, `sequence`, `delay`, `stagger` (stage 1).
- Gesture-linked motion: rubber-band overscroll, springs that inherit a gesture's release velocity (stage 1).
- Tweaking a named motion at the point of use, for example `{ "use": "snappy", "duration": 0.5 }`.
- Schemes: which names a scheme may supply or override, how the host passes one in, and how the validator still catches misspelled names. The built-in Apple-like and Material-like libraries.
- License.
