# The nudg format, version 1.1

The grammar and behavior of `.nudg.json` files. Behavior is pinned down by the [conformance suite](../spec/conformance/), the [JSON Schema](../spec/nudg-1.1.schema.json) describes the structure for editors, and every validator code is listed in the [error reference](errors.md). For the reasoning behind the format, see [Design](design.md).

**Stability.** Format 1.0 is stable. Within 1.x, files only gain: new fields, events, inputs and error codes may appear in a later 1.x version, but nothing a 1.0 file says changes meaning; a file opts into a 1.x version's rules by declaring it. Runtimes read every earlier version (0.1 to 1.0) unchanged; each was a superset of the one before, and `nudg upgrade` raises a file to the current version, 1.1. The [appendix](#appendix-format-history) lists what each version added.

```json
{
  "nudg": "1.1",
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

## Files

### Syntax: plain JSON

A nudg file is strict JSON with the extension `.nudg.json`. Every platform already parses it, JSON Schema describes it, and LLMs write it reliably, so there is no parser to maintain and nothing new to learn. A friendlier syntax can be added later as sugar that compiles to the same model, but JSON stays the source of truth.

A file may start with `"$schema": "https://unpkg.com/@nudg/core/spec/nudg-1.1.schema.json"` so editors offer completion and checks; runtimes ignore it. The schema also ships in the package as `@nudg/core/schema.json`.

JSON has no comments. Instead, any object may carry a `note` string. Runtimes ignore it. Unlike a comment, a note survives tools rewriting the file, and an AI can read it as part of the data.

### Top level

- `nudg`: the format version, a string (`"1.1"`).
- `host`: the app events and inputs the file uses ([below](#the-host-declaration)).
- `import`: motion libraries, by path.
- `targets`: the names a host binds to its views.
- `values`: every property's base value.
- `motions`: named motions.
- `animate`: each property's motion.
- A machine: `initial` + `states`, or `regions`, optionally with a machine-level `when`.

A file without a machine is a library: it has `motions` and may be imported.

### Units

- Time: a bare number is seconds; `"350ms"` is also accepted.
- Length: a bare number is a logical unit ([decision 7](design.md#design-decisions)); `"20px"`, `"20pt"` and `"20dp"` are the same logical units. Percentages are not supported.

### Colors

Colors are hex strings (`#RGB`, `#RRGGBB`, `#RRGGBBAA`) and interpolate in OKLab, which keeps midpoints from going muddy. A color can be tweened or sprung; it can't be kicked, followed, looped or glided.

### Unknown fields and extensions

An unknown key without a prefix is a validator error with a "did you mean" hint, so typos are caught instead of silently ignored. Keys starting with `x-` are extensions; runtimes that don't understand them ignore them.

### Named motions and imports

Platform motion is not special in nudg. Motion is defined in three layers, and the same format is used at every layer:

1. **Primitives** (in the core, defined by the spec and checked by the conformance suite): `spring`, `tween`, `kick`, entry `keyframes`, `loop` and `glide`. The core stays small.
2. **Named motions:** a file's `motions` defines motions by name, and anywhere a motion is expected, a name can be used instead. `import` brings in the named motions of other files, so a design system keeps its signature motion in one library and every component follows it. "Make the whole app snappier" is a one-line diff in that library.
3. **Schemes:** a motion library the host chooses. Apple-like and Material-like feels ship as nudg libraries written in this same format, not as runtime code, so a team's own signature motion is a peer of the platform ones.

Identical motion on every platform is the default: explicit parameters and named motions mean the same values everywhere. A scheme is an explicit input, so the same events with the same scheme still produce the same values, and the conformance suite can test each scheme.

```json
{
  "nudg": "1.1",
  "motions": {
    "snappy": { "spring": { "duration": 0.3, "bounce": 0.15 } },
    "pop": { "kick": 6, "spring": { "duration": 0.4, "bounce": 0.5 } }
  }
}
```

```json
{
  "nudg": "1.1",
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

- `import` paths are relative to the importing file. Imports may chain; a cycle is an error. Only `motions` are imported.
- A name defined twice (locally and in an import, or in two imports) is an error that names both sources. Use a new name instead of shadowing.
- A named motion can't carry a `delay`: that belongs to one transition's choreography.

### The host declaration

The app events and inputs a file uses, in one place:

```json
"host": {
  "events": ["connect", "connected", "failed", "leave"],
  "inputs": { "volume": { "range": [0, 1], "note": "Microphone level, normalized by the host." } }
}
```

- `events` lists event names and `inputs` maps input names to `{ "range"?, "note"? }`, all without `host.`. Names follow the `host.<name>` rules.
- **When a file declares `host`, it is closed:** a `host.<name>` event in any `when` or timer `pause`, or a `host.<name>` input anywhere a file reads one, that isn't declared is an error (`undeclared-host-event`, `undeclared-host-input`), with the nearest declared name as a hint. Without `host`, any name is accepted.
- Declared names nothing uses are warnings (`unused-host-event`, `unused-host-input`). A numeric `map.from` point outside an input's declared `range` is a warning (`outside-input-range`): the app never sends that value.
- Errors: `invalid-name`, `duplicate-host-name`, and `invalid-value` for a range that isn't two increasing numbers (the input stays declared).
- It changes no behavior. Runtimes accept any finite input value; the declaration is the contract, and `nudg generate` lists exactly the declared app names.

## Values

### Paths

One dotted form everywhere: `target.property` for values (`knob.x`), `target.event` for events (`track.tap`), `target.input` for inputs (`knob.drag.x`). The same string appears in `values`, `set`, `animate`, `enter`, `follow` and `when`, so it can be found and edited directly.

Properties are platform-neutral: `x`, `y`, `width`, `height` (lengths), `scale`, `scaleX`, `scaleY`, `rotation` (degrees), `opacity` (0 to 1) and `color`. Adapters translate them.

### Base values and bounds

Every property used anywhere must have a base value in `values`. A value may be an object: `{ "base": 0, "min": 0, "max": 200 }`. `min` and `max` bound `step` and `commit`, are the default `range` of a `follow` or `glide` on that property, clamp input targets, and make a `set` outside them a validator error. `base` alone is the same as writing the number.

### Value resolution

1. Start from `values` (the base, or what `step` and `commit` made it).
2. Apply `set` from every active state; a deeper state overrides its ancestors.
3. Two parallel regions can't set, follow, loop or glide the same property (`region-conflict`).

### Derived values: `map`

In `values`, a property can be computed from another property or an input instead of having its own base value:

```json
"action.opacity": { "map": "content.x", "from": [0, -80], "to": [0, 1] }
```

- `from` lists points on the source; `to` lists the derived values at those points (numbers, or colors interpolated in OKLab). Between points it's linear; outside, it holds the end value.
- At least two points. Numeric `from` points are strictly increasing or strictly decreasing.
- The source is a numeric property with its own base value (no chains of maps), or an [input](#inputs), read at its latest sample (0 before the first).
- A mapped property follows its source at every moment, during springs, drags and loops alike (it reads the shown value), so it can't be set, animated, followed, kicked, looped or glided itself.
- `from` points and numeric `to` values may be [measured](#measured-values): a measured `from` point resolves in the source property's coordinates (an input's map may measure sizes, but not aligned `x`/`y` positions, since an input has no source view); a measured `to` value resolves in the mapped property's own coordinates. Resolved points stay paired with their values and are ordered by their numbers.
- Until every measurement is reported, and while measured points coincide, the property holds its compiled base: the value at the numeric source point nearest the source's base among points whose value is a number, else the first numeric value, else 0. The first complete report applies at once; relayout updates the map without restarting anything.

### Measured values

The core never measures; the host reports [layout](#layout-inputs), the same way it reports the pointer. `{ "measure": "target.measurement", "times"?, "plus"? }` may stand for a number in `values`, in a state's `set`, in `follow` and `glide` ranges, in `map` points and values, and in loop values.

- **Positions align.** `{ "measure": "tab2.x" }` on `underline.x` is `tab2.layout.x - underline.layout.x`: the translation that puts the underline's box where tab2's box is. A position measures only into the same axis (`x` into `.x`, `y` into `.y`).
- **Sizes are the size.** `{ "measure": "panel.naturalHeight" }` on `panel.height` is the panel's natural height. A size may go into any numeric property.
- **Arithmetic.** `times` (default 1) multiplies and `plus` (default 0) adds, after alignment: `{ "measure": "sheet.height", "times": 0.5, "plus": -16 }` is `height * 0.5 - 16`. Both must be finite numbers.
- **Not reported yet:** a measured base or target is the property's base value (a measured base is 0); a `follow` or `glide` applies no range; a loop's offset is 0; a map holds its base.
- **First report places, later reports move.** When a layout input is reported for the first time, the values it changes take their new targets at once, without motion: that is where things are. When it changes later (a resize, a font loading, a longer label), each value whose target changed moves there with its property's motion, keeping its velocity, as if a state had set it. Ranges and map points follow relayout without restarting a follow.
- `nearest` compares measured targets like any others. `step` from a measured base starts from its measured value; `step` and `commit` replace the measurement with a number from then on.
- `runtime.measurements()` lists every measurement a file reads; `runtime.unmeasured()` those not reported yet.

### Targets read from inputs

In `set`, a numeric property's target may be `{ "input", "times"?, "plus"? }`:

```json
"live": { "set": { "needle.rotation": { "input": "host.level", "times": 180, "plus": -90 } } }
```

- The target is the input's latest sample (0 before the first) × `times` + `plus`, clamped to the property's bounds. Any input is allowed (app, scroll, drag, pinch); with a declared `host`, an app input must be declared.
- **A new sample retargets** every active target that reads it, with each property's motion, keeping its velocity, as a relayout does for measured targets. On one sample, targets move before any event the sample derives.
- Unlike `map`, which jumps with the input, the property travels to the value with its motion: a needle that springs to a reading, a row that springs to the slot the host computed.

## Machines and states

### Structure

- **Machine:** either `initial` + `states` (one active state at a time) or `regions` (named machines that all run in parallel).
- **State:** `set` (values while active), `follow`, `glide` and `loop` (values that move by themselves while active), `enter` (transient effects played on entry), `when` (transitions), and optionally a nested machine. Machines and states share this shape at every depth, which covers composition ([decision 2](design.md#design-decisions)).
- **Transition:** `"event": "target-state"` or `"event": { "to": ..., "animate": ..., "note": ... }`. A transition targets a sibling state; entering a state enters its nested machine at its `initial`, and leaving it leaves its children.
- Transitions live under `when`, not `on`, so they never collide with a state named `on`.

### Transitions

- **Motion per transition.** A transition's `animate` overrides `animate` for the properties it lists:

  ```json
  "track.tap": { "to": "off", "animate": { "knob.x": { "spring": { "duration": 0.3, "bounce": 0 } } } }
  ```

- **From any state.** A machine can list `when` next to `states` (or inside a region). It applies when no active state in that machine handles the event, so N tabs need N entries instead of N². It can't sit next to `regions`.
- **`nearest`: settle where the throw was heading.** `"knob.dragend": { "nearest": ["off", "on"], "by": "knob.x", "momentum": 0.5 }` projects where `by` was heading: its value plus its velocity times `momentum` seconds (default 0.5; 0 means position only). It goes to the listed sibling state whose target for `by` is closest to that point; on a tie, the first listed. A quick flick crosses over even from a short distance.
- **`step` and `commit`: changing a value for good.** `"step": { "thumb.x": 10 }` adds to a property's base (negative to subtract), clamped to its bounds; the value then travels to its new target with its usual motion. `"commit": ["thumb.x"]` makes the property's current value its new base, clamped: used when leaving a `follow`, so the thumb stays under the finger. A committed value is placed, not thrown: the finger's velocity is dropped. Both apply only to numeric properties with a plain base; while a state `set`s the property, the base is hidden until that state is left. A transition may `step` or `commit` without a `to`, staying in its state.

### Timers

A transition keyed `after:<time>` fires that long after the state was entered, if the state is still active:

```json
"shown": {
  "set": { "toast.opacity": 1 },
  "when": {
    "after:3s": { "to": "hidden", "pause": [{ "on": "toast.hoverstart", "off": "toast.hoverend" }, { "on": "host.suspend", "off": "host.resume" }] },
    "toast.tap": "hidden"
  }
}
```

- `<time>` is seconds or `ms`, as elsewhere (`after:3s`, `after:300ms`, `after:0.5`).
- The timer is set when the state is entered and cleared when it is left, so re-entering (including a transition to itself) restarts it. It belongs to a state's own `when`; a machine-level `after` is an error, because "after 3 s in any state" has no single start.
- Timers are part of the deterministic clock. A timer due at time `t` fires at exactly `t`: before any event sent at `t`, in order of due time (ties in file order), and even if the host only asks for a later time, in which case the runtime catches up first. Values that the firing changes start moving at `t`.
- **Pause.** Each `{ "on", "off" }` pair is an independent pause reason. The first `on` freezes the remaining duration; the timer resumes only after every active reason receives its `off`. Repeated `on` and inactive `off` events are idempotent; leaving or re-entering the state clears all reasons and resets the full duration. Pause events may also drive ordinary transitions. A timer due at the same timestamp fires before the incoming pause event.
- An unpaused pending timer keeps the runtime from settling, so real-time hosts wake to fire it; a paused one doesn't.

### Starting state

The runtime can start in states other than `initial` (for a controlled component that mounts already on), without animating: `createRuntime(program, { state: ["on"] })`. Paths are the ones `state()` reports (`checked/on`); regions not listed start at their `initial`. Entry effects of starting states don't play; their loops run from time 0.

## Events

Events are processed one at a time, in the order sent. Each event is offered to every active region, in the order the regions appear in the file; within a machine, the innermost active state gets it first, then the machine's own `when`. `send` returns whether anything handled it.

### Pointer

- `down`, `up`, `cancel`, `tap`. The host sends each as a separate event; a click is `down`, `up`, `tap`, in that order. A release outside the target is `cancel`, and no `tap`.
- **Drag.** On a target the file drags (it handles `dragstart` or `dragend`, or follows its drag input), `dragstart` comes once the pointer has moved more than 4 logical units since `down`; `dragend` when it's released or cancelled after that. A release after a drag sends `up` (or `cancel`) and then `dragend`, and no `tap`.
- **Pinch.** On a target that handles `pinchstart` or `pinchend`, a second pointer while the first is down ends any drag (`dragend`) and starts a pinch (`pinchstart`); the second pointer sends no `down`. Lifting either pointer ends it (`pinchend`); the first pointer's release still sends `up` (or `cancel`) but no `tap`, and the remaining pointer doesn't drag. Targets that don't handle pinches ignore a second pointer.
- `PointerTracker` in each language implements these rules for hosts without the DOM, and is checked against the same sequences.

### Hover and focus

- `hoverstart` and `hoverend`: a hovering pointer (mouse or pen) enters or leaves the target. Touch doesn't hover.
- `focus` and `blur`: the target, or something inside it, gains or loses keyboard focus.

### Keys

- `target.key.<name>` fires on each key press (including auto-repeat) while the target, or something inside it, has keyboard focus. Names are the web's `KeyboardEvent.key` values, lowercased, with `space` for the space bar: `space`, `enter`, `escape`, `tab`, `backspace`, `delete`, `arrowup`, `arrowdown`, `arrowleft`, `arrowright`, `home`, `end`, `pageup`, `pagedown`, single characters (`a`, `1`, `/`), and function keys (`f1`). The namespace stays open (decision 4).
- When a transition handles a key, the adapter stops the browser's default for it (the page doesn't scroll on `space` or the arrows). Keys that no transition handles pass through.
- A `tap` still comes from activation (a click, or Space/Enter on a native button), so a button needs no key transitions of its own.

### App events

`host.<name>`: an event the app sends, for example `host.check` when a controlled toggle's `checked` prop turns true. `host` is reserved and can't be a target name. With a [host declaration](#the-host-declaration), only declared names are accepted.

### Derived gestures

The runtime derives these from the events a host already sends, only for targets whose `longpress` or `doubletap` some transition handles, so files that don't use them see no change. A host may also send them itself.

- **`target.longpress`** fires when `target.down` has been held 0.5 s without `up`, `cancel`, `dragstart` or `pinchstart`. It fires at exactly that moment, from the runtime's clock like a timer (a timer due at the same time fires first). The `target.tap` that ends a long press is not delivered: `send` returns false. A pending long press keeps the runtime from settling, like an unpaused timer.
- **`target.doubletap`** follows a `target.tap` that comes at most 0.3 s after the previous delivered `target.tap`, at the same time and right after it. The pair is then complete; a third tap starts a new one. The first tap is never delayed: a file that must not react to it gives the tap and the double tap different meanings, as platforms do.
- The DOM adapter suppresses the browser's context menu and touch callout on targets that handle `longpress`. Moving a finger without a drag doesn't cancel a long press; a scroll that takes the pointer does (`cancel`).

### Events from inputs

```json
"when": { "scroller.scroll.y<24": "shown", "host.volume>0.6": "speaking" },
"states": { "shown": { "when": { "scroller.scrolldown": "hidden" } } }
```

- **A crossing** is an event key made of an input, `>` or `<`, and a number: `host.volume>0.6`, `list.scroll.y<40`, `card.drag.x<-80`. The input is an app, scroll, drag or pinch input; properties are not allowed, since their values between frames depend on when they are sampled. The event fires when an input sample makes the condition true while the previous value made it false, and not again until a sample makes it false. Before the first sample the value is its start (0, or 1 for `pinch.scale`); `dragstart` and `pinchstart` reset their inputs' crossings to that start. There is no `>=`.
- **Scroll direction:** `target.scrolldown` and `target.scrollup` (and `scrollright`, `scrollleft` for x) fire from the target's `scroll.y` (or `scroll.x`) samples. Down means the offset grows. The runtime keeps the direction last reported and the furthest offset reached in it (0 at first); a sample 8 units or more beyond that point in the other direction reports the new direction. Wobbles under 8 units are ignored.
- On one sample: targets read from the input move first, then a direction event is delivered, then crossings, in the order of their event names.
- Using either makes the runtime require the input, so the DOM adapter reports the scroll position of the bound element.

## Inputs

Inputs are continuous values the host supplies over time with `input(name, value)`. Runtimes accept only inputs the program references, and return false for unknown names or non-finite values. Device APIs remain the host's: nudg receives numbers.

- **Drag:** `target.drag.x` and `target.drag.y` are the pointer's travel since `down`, in logical units. `dragstart` sets them to 0, so on the first sample a followed value catches up by the distance the pointer moved before the drag was recognized, and stays under the finger.
- **Pinch:** `target.pinch.scale` (the distance between the two pointers over their distance at the start), `target.pinch.rotation` (degrees the line between them has turned, in (-180, 180]) and `target.pinch.x` / `pinch.y` (how far their midpoint has moved). `pinchstart` sets them to 1, 0, 0 and 0. SwiftUI reports the system's magnify and rotate gestures, without the midpoint.
- **Scroll:** `target.scroll.x` and `target.scroll.y` are the bound scrolling view's offsets. The DOM adapter reports a referenced scroll input automatically; other hosts call `input` from their scroll system.
- **App:** `host.<name>` is a finite number the app supplies, such as `host.volume`, `host.tilt` or `host.progress`, at any rate. Before the first sample it is 0.
- **Velocity** is computed by the runtime, never by the host, so every platform agrees: the least-squares slope of an input's samples over the 0.1 s before the moment it's needed, or 0 with fewer than two samples in that window.

### Layout inputs

For each bound target the host reports `target.layout.x`, `.y`, `.width`, `.height` (the box as laid out, without any motion nudg applies, in logical units and one coordinate space per player) and `.naturalWidth`, `.naturalHeight` (the size the content needs unconstrained: CSS's `auto`). It reports them when the player starts, and again whenever they change. They are read only through [measured values](#measured-values).

## Motion

### Motion model

- **States say where.** A state only declares target values.
- **`animate` says how.** It maps each property to the motion that carries it to its target. When the target changes mid-flight (a second tap while the knob is still moving), the value retargets from where it is. A spring also keeps its velocity, so interruption is correct by default instead of a special case.
- **`enter` adds a moment.** Some feedback is transient: a heart that pops and settles back, a field that shakes. The target doesn't change, so `enter` plays a spring *kick* or authored *keyframes* when a state is entered through a transition.
- **Some values move by themselves while a state is active:** a `follow` tracks an input, a `glide` carries a throw on, a `loop` repeats.
- A property with no motion jumps to its target.

### Primitives

- **`spring`:** platforms offer many spring APIs, but they describe one physical model (mass, stiffness, damping) in different forms. nudg has one spring primitive and accepts the common forms:
  - `duration` + `bounce` (the default form). `duration` is perceptual, in seconds. `bounce` is 0 for no overshoot, toward 1 for more bounce, and negative for overdamped; it must be below 1. With mass 1, stiffness = (2π / duration)² and damping ratio = 1 − bounce.
  - `response` + `dampingFraction`, where response = duration and dampingFraction = 1 − bounce.
  - `stiffness` + `dampingRatio`, with mass 1.
  - `stiffness` + `damping` + `mass`.

  Every form converts exactly to stiffness, damping, and mass, which is what the spec computes with. A spring uses exactly one form; mixing them is a validator error. `tension` / `friction` are rejected with a hint, because tools disagree on what they mean. Fit-to-duration springs (a fixed total time plus a damping value) are not supported, because they don't map to a single physical spring. The spec defines springs by their closed-form solution, so results are deterministic ([decision 3](design.md#design-decisions)).
- **`tween`:** `duration` and `ease`. `ease` is `linear`, `in`, `out`, `in-out`, one of the classic curve families (`in-`, `out-` or `in-out-` followed by `sine`, `quad`, `cubic`, `quart`, `quint`, `expo`, `circ` or `back`, e.g. `out-cubic`), or a cubic Bézier `[x1, y1, x2, y2]`; the default is `in-out`. Bounce and elastic aren't curves: use a spring. On retarget, a tween restarts from the current value with its full duration. A zero `duration` jumps.
- **`kick`:** adds velocity (units per second) to a numeric property without changing its target, then lets the motion's `spring` carry it back. A kick always comes with a `spring`, and only in `enter`. A positive kick on `scale` is a pop; a negative kick on `x` with a high bounce is a shake.

### Delay

A motion in `animate` (top level or a transition's) may have `delay`, a time of 0 or more, for sequence and stagger:

```json
"anchor.tap": {
  "to": "open",
  "animate": {
    "item1.opacity": { "tween": { "duration": 0.15 }, "delay": 0.05 },
    "item2.opacity": { "tween": { "duration": 0.15 }, "delay": 0.08 }
  }
}
```

- When a property's target changes and its motion has a delay, the new motion starts `delay` seconds later, from the property's position and velocity at that moment.
- **During the delay the property keeps doing what it was doing**: a spring or tween in flight continues toward its old target, a value at rest stays. A value that a commit placed, or that a loop handed off, holds still.
- **A retarget during the delay** drops the pending motion: the new one (with its own delay, if any) starts from what the property was doing before the dropped one. A retarget to the same target leaves the pending motion alone.
- A property with a pending motion is not at rest. `delay` in a named motion or on an entry kick is `delay-outside-animate`.

### Entry effects

`enter` lists effects played when the state is entered through a transition (not when a player starts in it): a spring with a `kick`, or keyframes.

```json
"enter": {
  "field.x": {
    "keyframes": [{ "at": 0.16, "value": -10 }, { "at": 0.36, "value": 9 }, { "at": 0.58, "value": -6 }],
    "duration": 0.42,
    "ease": "out-quad"
  }
}
```

- The property's exact current value is the implicit frame at `at: 0`; the active state's resolved target is the implicit frame at `at: 1`. Files list only strictly increasing intermediate points between them.
- `duration` is greater than zero. `ease` uses the tween names or cubic Bézier form, defaults to `linear`, and applies independently to each leg.
- Re-entering the state samples the current value and restarts the sequence without a position jump. Leaving while it plays samples both position and velocity; the destination's ordinary spring can carry that velocity forward.
- A transition in an unrelated parallel region does not interrupt the sequence. Relayout updates its implicit final target without restarting it.
- Keyframes are inline entry effects, not named motions and not transition `animate`.

### Following an input

In a state's `follow`, a property tracks an input directly, with no motion:

```json
"follow": { "knob.x": { "input": "knob.drag.x", "range": [0, 20], "overdrag": 0.3 } }
```

- The value is the property's value when the state was entered, plus how far the input has moved since then. Starting from the current value means no jump, even mid-animation.
- With `"multiply": true`, the value is its value at entry × the input's ratio since entry instead: a pinch zoom, where a second pinch continues from the first. From an input at 0 there is no ratio, and the value holds.
- `range` (optional; the property's `min`/`max` by default; numbers or measured) bounds it. Past the range, the value moves `overdrag` times as far as the input (0 to 1; default 0, a hard stop), which feels like a rubber band.
- `"follow": { "knob.x": "knob.drag.x" }` is the short form, with no range.
- When the state is left, the property moves to its new target from where it is, and a spring starts with the input's velocity: the finger's speed carries into the motion.
- A followed property must be numeric and can't also be set, given an entry effect, looped or glided in that state.

### Glide

A value that keeps the velocity it had when its state was entered and slows down by itself:

```json
"free": {
  "glide": { "strip.x": { "momentum": 0.5, "range": [{ "measure": "strip.width", "times": -1, "plus": 240 }, 0] } },
  "when": { "strip.dragstart": "dragging" }
}
```

- The property starts from its value and velocity at entry (a released follow hands over the finger's speed) and moves as `x0 + v0·m·(1 − e^(−t/m))`, with velocity `v0·e^(−t/m)`, where `m` is `momentum` (seconds, default 0.5). It travels `v0·m` in all: exactly where `nearest` with the same momentum projects a throw.
- **Range** (optional; the property's `min`/`max` by default; numbers or measured) bounds it. If the glide would pass a bound, it reaches it at `t = −m·ln(1 − (bound − x0)/(v0·m))` and from then on settles at the bound with the property's motion in `animate`, starting at the speed it had (no motion: it stops there). A glide that starts outside the range settles at the nearer bound at once.
- It has no target: `targets()` reports it like a followed value. Leaving the state hands its value and velocity to the next motion; a committed property glides from rest.
- A gliding property must be numeric and can't also be set, followed, looped or given an entry effect in that state (`glide-conflict`).

### Loops

Periodic motion while a state is active, for spinners, shimmers and typing dots:

```json
"refreshing": {
  "set": { "list.y": 56 },
  "loop": { "spinner.rotation": { "to": 360, "duration": 0.8, "wrap": 360 } }
}
```

- **A loop is an offset added to a numeric property** while the state that lists it is active. The property keeps its ordinary value (base, `set`, motion, kicks, keyframes); what it shows is that value plus the offset.
- **One cycle** runs from offset 0 at normalized time 0, through optional `keyframes` (`{ "at", "value" }`, `at` strictly increasing between 0 and 1), to `to` at 1 (default 0), and repeats every `duration` seconds. `ease` applies to each leg; the default is `linear`. A cycle that ends away from 0 (a turn, a sweep) starts again at 0. `to` and keyframe values may be measured.
- **Timing.** The cycle starts when the state is entered, after `delay` seconds (default 0) during which the offset is 0. Re-entering the state, including a transition to itself, restarts it.
- **Leaving.** When the state is left (or re-entered), the property continues from what it shows, with its own velocity plus the loop's, toward its new target with the destination's motion. If the loop has `wrap` (a period, e.g. 360), the offset is first reduced to its equivalent in `(-wrap/2, wrap/2]`: `offset - wrap * ceil(offset / wrap - 0.5)`. The shown value jumps by whole periods, which a rotation doesn't show.
- `to` or `keyframes` and `duration` are required; `delay` is a time of 0 or more; `wrap` is greater than 0. A property followed or glided in the same state can't loop there.
- `runtime.looping()` is true while any loop runs; adapters keep drawing frames while it is true, even when nothing settles.

### Reduced motion

Some people ask the system to reduce motion (`prefers-reduced-motion`; WCAG 2.3.3). The format says nothing about it; the runtime does, as an option: `createRuntime(program, { reducedMotion: true })`.

- Every spring and tween becomes a short linear tween (0.15 s), and delays are ignored. Kicks, entry keyframes and loops don't play.
- **From 1.1, a loop on `opacity` still plays.** It fades; nothing moves, scales or turns, which is what reduced motion is for (WCAG 2.3.3 names motion animation; the platforms' guidance replaces movement with fades). A loading indicator therefore keeps signalling progress. A file declaring 1.0 or older keeps the earlier rule, so its meaning doesn't change.
- A glide keeps going: it is the user's own throw. Settling at a bound uses the short tween.
- States, transitions, timers and followed values are unchanged, so nothing functional depends on the setting.
- The DOM adapter follows the system setting unless the option is passed explicitly; `simulate`, `plot` and `render` take `--reduced-motion`.

## Rest and lifecycle

Hosts need to know when motion is over: to move focus once a dialog has opened, to tell a component library its transition has entered, to remove an element once its exit has played. These rules make that moment the same in every runtime and adapter.

**Rest.** A property is at rest at time `t` when:

- it is mapped from a continuous input, or it follows an input in an active state (it moves only when the input does);
- it is mapped from another property that is at rest;
- its last change was a tween or keyframes whose duration has elapsed, or a jump with no motion;
- it glides and what is left of its travel, `|v|·m`, is under 0.001;
- or its last change was a spring whose remaining amplitude, `sqrt((x - target)^2 + v^2 * m / k)` per channel, is below 0.001 (numbers, in logical units) or 0.0001 (colors, per OKLab channel). This is the spring's energy, which never grows, so once a property rests it stays at rest until its target changes.

A running loop's offset never counts: a looping property is at rest when its own motion is. A property with a delayed motion still to start is not at rest.

The runtime is **resting** when every property is at rest, whatever timers are pending, and **settled** when it is resting and no unpaused timer or long press is pending. Values are never snapped at rest; the thresholds only decide when motion is over.

**Lifecycle notifications.** Adapters report, by the same rules:

- **State:** the active states, after an event, a timer or a derived event changes them.
- **Settle:** the active states, once each time the runtime is resting after something moved or the state changed. An interrupted motion reports only the rest that follows the interruption. A state change that moves nothing settles at the next frame. An event nobody handles, and input samples that only move followed or mapped values, report nothing. Pending timers don't delay a settle: a toast settles once shown while its dismiss timer runs, and again once hidden. A host may send events from inside the notification.
- **Exit:** once the machine has entered a host-named exit state from another state and the runtime is settled. Mounting in an exit state is not an exit.

**First frame.** Before anything happens, a player shows the starting states (the host's, or `initial`), with app inputs as the host gives them (0 otherwise) and measured values at their base until the first layout report. Entry effects of the starting states don't play. Every adapter starts from this frame, and a server can compute it without a clock or platform APIs, so a server-rendered page hydrates without a jump.

Settle is reported from the frame loop, never from inside the call that sent the event. While a loop runs, or a timer or long press is pending, the frame loop continues.

## Compiled programs

`nudg compile` writes a file's compiled form as JSON (`"nudgProgram": 8`): validated, imports and named motions resolved, spring forms reduced to stiffness, damping and mass, colors as OKLab channels, and every map written as an array of entries so order survives any JSON reader. Runtimes in other languages read this instead of porting the validator; the reference implementation stays the one that explains errors. `spec/conformance/programs/` holds every behavior case compiled this way, and the conformance suite is run against both forms. Program format 8 is frozen with format 1.0; runtimes read every earlier program format. A program carries its file's `version`, and a runtime applies that version's rules (1.1's reduced-motion loops); a 1.0 runtime given a 1.1 program plays it by 1.0's rules, which only differ under reduced motion.

## Appendix: format history

Each version added to the one before and kept everything it had. A 1.1 runtime reads them all; `nudg upgrade` raises a file to 1.1. The conformance cases named here define each addition across TypeScript, Swift and Kotlin; compiled programs gained a format when they needed new fields.

| Format | Added | Conformance | Program |
|---|---|---|---|
| 0.1 | States, `set`, `when`, `animate`; `spring`, `tween`, `kick` in `enter`; named motions and `import`; colors in OKLab; pointer events | `toggle-*`, `spring-*`, `kick-pop`, `tween`, `nested-states`, `parallel-regions`, `validation` | 1 |
| 0.2 | Drag events and inputs, `follow`, `nearest`, `map`, machine-level `when`, hover and focus events, `host.<name>` events, starting state | `drag-*`, `any-state-transitions`, `validation-0.2` | 1 |
| 0.3 | Key events, `after:` timers, `step` and `commit`, `min` / `max`, reduced motion | `timer-*`, `step-keys`, `commit-*`, `reduced-motion`, `validation-0.3` | 1 |
| 0.4 | Layout inputs and `measure` | `layout-*`, `validation-0.4` | 1 |
| 0.5 | App and scroll inputs for `map` and `follow` | `continuous-inputs`, `validation-0.5` | 1 |
| 0.6 | `times` and `plus` on measurements | `layout-arithmetic`, `validation-0.6` | 1 |
| 0.7 | Pausable timers | `timer-pause`, `validation-0.7` | 1 |
| 0.8 | Entry keyframes | `keyframes-*`, `validation-0.8` | 1 |
| 0.9 | Measured `follow.range` and `map.from` | `measured-endpoints`, `validation-0.9` | 2 |
| 0.10 | Loops | `loop-*`, `validation-0.10` | 3 |
| 0.11 | Measured map values | `measured-map-values`, `validation-0.11` | 4 |
| 0.12 | Motion `delay` | `delay-*`, `validation-0.12` | 5 |
| 0.13 | The `host` declaration | `validation-0.13` | 5 |
| 0.14 | `longpress`, `doubletap` | `gestures`, `validation-0.14` | 5 |
| 0.15 | Input crossings, scroll direction events | `thresholds`, `validation-0.15` | 5 |
| 0.16 | `glide` | `glide`, `validation-0.16` | 6 |
| 0.17 | Targets read from inputs | `input-targets`, `validation-0.17` | 7 |
| 0.18 | Pinch events and inputs, multiplying `follow` | `pinch`, `validation-0.18` | 8 |
| 1.0 | Nothing new: 0.18, frozen and declared stable | the whole suite | 8 |
| 1.1 | Under reduced motion, opacity loops keep playing | `loop-fade`, `loop-reduced-fade`, `loop-reduced-fade-1.0` | 8 |

The `rest` case defines rest and lifecycle across all of them. Before 0.5, `map` and `follow` read only properties and drag inputs; before 0.9, ranges and map points were numbers; and so on: a feature used in a file that declares an older version is a `needs-version` error whose hint names the version that added it.
