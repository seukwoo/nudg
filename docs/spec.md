# The nudg format

The grammar of `.nudg.json` files. Behavior is pinned down by the [conformance suite](../spec/conformance/), and the [JSON Schema](../spec/nudg-0.1.schema.json) describes the structure for editors. For the reasoning behind the format, see [Design](design.md).

## Version 0.1 (draft)

Worked out by expressing a toggle and a like button. See [`examples/`](../examples/).

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

A file may start with `"$schema": "https://unpkg.com/@nudg/core@0.3/spec/nudg-0.3.schema.json"` so editors offer completion and checks; runtimes ignore it. The schema also ships in the package as `@nudg/core/schema.json`.

JSON has no comments. Instead, any object may carry a `note` string. Runtimes ignore it. Unlike a comment, a note survives tools rewriting the file, and an AI can read it as part of the data.

### Motion model

- **States say where.** A state only declares target values.
- **`animate` says how.** It maps each property to the motion that carries it to its target. When the target changes mid-flight (a second tap while the knob is still moving), the value retargets from where it is. A spring also keeps its velocity, so interruption is correct by default instead of a special case.
- **`enter` adds a moment.** Some feedback is transient: a heart that pops and settles back, a field that shakes. The target doesn't change, so `enter` plays a *kick* when a state is entered through a transition (see below). Loading a file enters its initial states without kicks.

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
- **State:** `set` (values while active), `enter` (kicks played on entry), `when` (transitions), and optionally a nested machine. Machines and states share this shape at every depth, which covers composition ([decision 2](design.md#design-decisions)).
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

  Every form converts exactly to stiffness, damping, and mass, which is what the spec computes with. A spring uses exactly one form; mixing them is a validator error. `tension` / `friction` are rejected with a hint, because tools disagree on what they mean. Fit-to-duration springs (a fixed total time plus a damping value) are not supported, because they don't map to a single physical spring. The spec defines springs by their closed-form solution, so results are deterministic ([decision 3](design.md#design-decisions)).
- **`tween`:** `duration` and `ease`. `ease` is `linear`, `in`, `out`, `in-out`, one of the classic curve families (`in-`, `out-` or `in-out-` followed by `sine`, `quad`, `cubic`, `quart`, `quint`, `expo`, `circ` or `back`, e.g. `out-cubic`), or a cubic Bézier `[x1, y1, x2, y2]`; the default is `in-out`. Bounce and elastic aren't curves: use a spring. On retarget, a tween restarts from the current value with its full duration.
- **`kick`:** adds velocity (units per second) to a numeric property without changing its target, then lets the motion's `spring` carry it back. A kick always comes with a `spring`. A positive kick on `scale` is a pop; a negative kick on `x` with a high bounce is a shake.

### Colors

Colors are hex strings (`#RGB`, `#RRGGBB`, `#RRGGBBAA`) and interpolate in OKLab, which keeps midpoints from going muddy. A color can be tweened or sprung; a kick on a color is an error.

### Units

- Time: a bare number is seconds; `"350ms"` is also accepted.
- Length: a bare number is a logical unit ([decision 7](design.md#design-decisions)).

### Unknown fields and extensions

An unknown key without a prefix is a validator error with a "did you mean" hint, so typos are caught instead of silently ignored. Keys starting with `x-` are extensions; runtimes that don't understand them ignore them.

## Additions in 0.2 (draft)

Stage 1 is about continuous interaction: a value follows a finger, and on release it settles somewhere sensible. Worked out by expressing a draggable toggle and a swipe-to-reveal row. A file that uses any of this declares `"nudg": "0.2"`; a 0.2 runtime also reads 0.1 files.

```json
{
  "nudg": "0.2",
  "targets": ["knob", "track"],
  "values": {
    "knob.x": 0,
    "track.color": { "map": "knob.x", "from": [0, 20], "to": ["#D1D5DB", "#4ADE80"] }
  },
  "animate": { "knob.x": { "spring": { "duration": 0.35, "bounce": 0.25 } } },
  "initial": "off",
  "states": {
    "off": { "when": { "track.tap": "on", "knob.dragstart": "dragging" } },
    "on": { "set": { "knob.x": 20 }, "when": { "track.tap": "off", "knob.dragstart": "dragging" } },
    "dragging": {
      "follow": { "knob.x": { "input": "knob.drag.x", "range": [0, 20], "overdrag": 0.3 } },
      "when": { "knob.dragend": { "nearest": ["off", "on"], "by": "knob.x" } }
    }
  }
}
```

### Drag events and inputs

- **Events:** `dragstart` once the pointer has moved more than 4 logical units since `down`; `dragend` when it's released or cancelled after that. A release after a drag sends `up` (or `cancel`) and then `dragend`, and no `tap`.
- **Inputs** are continuous values the host supplies over time. `target.drag.x` and `target.drag.y` are the pointer's travel since `down`, in logical units. `dragstart` counts as 0, so on the first sample a followed value catches up by the distance the pointer moved before the drag was recognized, and stays under the finger.
- **Velocity** is computed by the runtime, never by the host, so every platform agrees: the least-squares slope of an input's samples over the 0.1 s before the moment it's needed, or 0 with fewer than two samples in that window.

### `follow`: a value that tracks an input

In a state's `follow`, a property tracks an input directly, with no motion:

```json
"follow": { "knob.x": { "input": "knob.drag.x", "range": [0, 20], "overdrag": 0.3 } }
```

- The value is the property's value when the state was entered, plus how far the input has moved since then. Starting from the current value means no jump, even mid-animation.
- `range` (optional) bounds it. Past the range, the value moves `overdrag` times as far as the input (0 to 1; default 0, a hard stop), which feels like a rubber band.
- `"follow": { "knob.x": "knob.drag.x" }` is the short form, with no range.
- When the state is left, the property springs (or tweens) to its new target from where it is, and a spring starts with the input's velocity: the finger's speed carries into the motion.
- A followed property must be numeric, can't also be in that state's `set`, and two parallel regions can't follow the same property.

### `nearest`: settle where the throw was heading

A transition can choose its target on the spot:

```json
"knob.dragend": { "nearest": ["off", "on"], "by": "knob.x" }
```

- The runtime projects where `by` was heading: its value plus its velocity times `momentum` seconds (default 0.5; 0 means position only). A quick flick crosses over even from a short distance.
- It goes to the listed sibling state whose target for `by` is closest to that point; on a tie, the first listed.
- Like any transition, it may also carry `animate` to override motion.

### `map`: a value derived from another

In `values`, a property can be computed from another property instead of having its own base value:

```json
"action.opacity": { "map": "content.x", "from": [0, -80], "to": [0, 1] }
```

- `from` lists points on the source property; `to` lists the derived values at those points (numbers, or colors interpolated in OKLab). Between points it's linear; outside, it holds the end value.
- At least two points; `from` must be strictly increasing or strictly decreasing.
- The source must be a numeric property with its own base value (no chains of maps in v0.2).
- A mapped property follows its source at every moment, during springs and drags alike, so it can't be set, animated, followed or kicked itself.

### Transitions from any state

A machine can list `when` next to `states` (or inside a region). It applies when no active state in that machine handles the event, so N tabs need N entries instead of N².

### More events

- `hoverstart` and `hoverend`: a hovering pointer (mouse or pen) enters or leaves the target.
- `focus` and `blur`: the target gains or loses keyboard focus.
- `host.<name>`: an event the app sends, for example `host.check` when a controlled toggle's `checked` prop turns true. `host` is reserved and can't be a target name.

### Starting state

The runtime can start in states other than `initial` (for a controlled component that mounts already on), without animating: `createRuntime(program, { state: ["on"] })`. Paths are the ones `state()` reports; regions not listed start at their `initial`.

## Additions in 0.3 (draft)

Stage 1 continued: what the platforms' component guidelines (WAI-ARIA Authoring Practices, Apple HIG, Material 3) need that 0.2 couldn't say. Worked out by expressing a slider, a tooltip, a dialog and an auto-hiding toast. A file that uses any of this declares `"nudg": "0.3"`; a 0.3 runtime also reads 0.1 and 0.2 files.

```json
{
  "nudg": "0.3",
  "targets": ["thumb", "track"],
  "values": { "thumb.x": { "base": 0, "min": 0, "max": 200 } },
  "animate": { "thumb.x": { "spring": { "duration": 0.3, "bounce": 0.1 } } },
  "initial": "idle",
  "states": {
    "idle": {
      "when": {
        "thumb.key.arrowright": { "step": { "thumb.x": 10 } },
        "thumb.key.arrowleft": { "step": { "thumb.x": -10 } },
        "thumb.key.home": { "step": { "thumb.x": -1000 } },
        "thumb.key.end": { "step": { "thumb.x": 1000 } },
        "thumb.dragstart": "dragging"
      }
    },
    "dragging": {
      "follow": { "thumb.x": "thumb.drag.x" },
      "when": { "thumb.dragend": { "to": "idle", "commit": ["thumb.x"] } }
    }
  }
}
```

### Keyboard events

- `target.key.<name>` fires on each key press (including auto-repeat) while the target, or something inside it, has keyboard focus. Names are the web's `KeyboardEvent.key` values, lowercased, with `space` for the space bar: `space`, `enter`, `escape`, `tab`, `backspace`, `delete`, `arrowup`, `arrowdown`, `arrowleft`, `arrowright`, `home`, `end`, `pageup`, `pagedown`, single characters (`a`, `1`, `/`), and function keys (`f1`). The namespace stays open (decision 4).
- When a transition handles a key, the adapter stops the browser's default for it (the page doesn't scroll on `space` or the arrows). Keys that no transition handles pass through.
- A `tap` still comes from activation (a click, or Space/Enter on a native button), so a button needs no key transitions of its own.

### Timers: `after`

A transition keyed `after:<time>` fires that long after the state was entered, if the state is still active:

```json
"shown": { "set": { "toast.opacity": 1 }, "when": { "after:3s": "hidden", "toast.tap": "hidden" } }
```

- `<time>` is seconds or `ms`, as elsewhere (`after:3s`, `after:300ms`, `after:0.5`).
- The timer is set when the state is entered and cleared when it is left, so re-entering (including a transition to itself) restarts it. It belongs to a state's own `when`; a machine-level `after` is an error, because "after 3 s in any state" has no single start.
- Timers are part of the deterministic clock. A timer due at time `t` fires at exactly `t`: before any event sent at `t`, in order of due time (ties in file order), and even if the host only asks for a later time, in which case the runtime catches up first. Values that the firing changes start moving at `t`, not when the host asked.
- While a timer is pending, the machine isn't at rest, so `settled` is false and a simulation keeps running until it fires.

### `step` and `commit`: changing a value for good

States say where, and so far nothing else could: every value had one base and the states' targets. A slider's thumb has to stay where the keys or the finger put it. Two transition operators change a property's **base value** itself:

- `"step": { "thumb.x": 10 }` adds to the base (negative to subtract), clamped to the property's `min`/`max`. The value then travels to its new target with its usual motion. A transition may `step` without a `to`, staying in its state.
- `"commit": ["thumb.x"]` makes the property's current value its new base, clamped, at the moment of the transition. Used when leaving a `follow`: the thumb stays under the finger instead of springing back. A committed value is placed, not thrown: the finger's velocity is dropped, so a thumb released mid-move doesn't wobble.
- Both apply only to numeric properties with a plain base (not mapped). While a state `set`s the property, the base is hidden until that state is left.

### Property bounds: `min` and `max`

A value in `values` may be an object: `{ "base": 0, "min": 0, "max": 200 }`. `min` and `max` bound `step` and `commit`, are the default `range` of a `follow` on that property, and make a `set` outside them a validator error. `base` alone is the same as writing the number.

### Reduced motion

Some people ask the system to reduce motion (`prefers-reduced-motion`; WCAG 2.3.3). The format says nothing about it; the runtime does, as an option: `createRuntime(program, { reducedMotion: true })`.

- Every spring and tween becomes a short linear tween (0.15 s), and kicks are ignored. States, transitions, timers and followed values are unchanged, so nothing functional depends on the setting.
- The DOM adapter follows the system setting unless the option is passed explicitly; `simulate`, `plot` and `render` take `--reduced-motion`.

## Additions in 0.4 (draft)

Layout as input. Motion that depends on where things are or how big they are: a tab underline under a label whose width depends on its text, an accordion that opens to its content, a sheet whose stops depend on the screen. The core never measures; the host reports layout, the same way it reports the pointer. A file that uses this declares `"nudg": "0.4"`; a 0.4 runtime also reads 0.1 to 0.3 files. The reasoning is in [Design](design.md#proposal-layout-as-input-format-04).

```json
{
  "nudg": "0.4",
  "targets": ["tab1", "tab2", "underline"],
  "values": { "underline.x": 0, "underline.width": { "measure": "tab1.width" } },
  "animate": { "underline.x": "snappy", "underline.width": "snappy" },
  "initial": "first",
  "when": { "tab1.tap": "first", "tab2.tap": "second" },
  "states": {
    "first": { "set": { "underline.x": { "measure": "tab1.x" } } },
    "second": { "set": { "underline.x": { "measure": "tab2.x" }, "underline.width": { "measure": "tab2.width" } } }
  }
}
```

### Layout inputs

For each bound target the host reports `target.layout.x`, `.y`, `.width`, `.height` (the box as laid out, without any motion nudg applies, in logical units and one coordinate space per player) and `.naturalWidth`, `.naturalHeight` (the size the content needs unconstrained: CSS's `auto`). It reports them when the player starts, and again whenever they change. `runtime.measurements()` lists what a file reads; `runtime.unmeasured()` what hasn't been reported yet.

### `measure`

`{ "measure": "target.measurement" }` may stand for a number in `values` and in a state's `set`.

- **Positions align.** `{ "measure": "tab2.x" }` on `underline.x` is `tab2.layout.x - underline.layout.x`: the translation that puts the underline's box where tab2's box is. A position measures only into the same axis (`x` into `.x`, `y` into `.y`).
- **Sizes are the size.** `{ "measure": "panel.naturalHeight" }` on `panel.height` is the panel's natural height. A size may go into any numeric property.
- **Not reported yet:** a measured value is its property's base value (a measured base is 0), until everything it reads has been reported.
- **First report places, later reports move.** When a layout input is reported for the first time, the values it changes take their new targets at once, without motion: that is where things are. When it changes later (a resize, a font loading, a longer label), each value whose target changed moves there with its property's motion, keeping its velocity, as if a state had set it.
- `nearest` compares measured targets like any others. `step` from a measured base starts from its measured value; `step` and `commit` replace the measurement with a number from then on.
- No arithmetic in 0.4: an offset or a fraction of a size is an open question.

### Errors

`invalid-measure` (not `target.measurement`, an unknown measurement, a position into another axis or a size property, or a color property), `unknown-target`, and `needs-version` below 0.4. The conformance cases `layout-*.json` and `validation-0.4.json` define the behavior.

