# nudg guide for AI agents

nudg files describe a UI interaction: states, the events that move between them, and the motion in between. They are strict JSON (`*.nudg.json`). The host app plays them; you edit them. After every edit, run `nudg_validate`, then check the behavior with `nudg_simulate` or `nudg_plot` (and `nudg_render` when the host page is available).

## Skeleton

```json
{
  "nudg": "0.1",
  "note": "What this interaction is for.",
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

- **States say where** (`set`), **`animate` says how** each property travels there. A change mid-flight retargets from the current value; springs keep their velocity.
- `targets` are names the host binds to its views (`data-nudg="knob"` on the web).
- Every property used anywhere needs a base value in `values`.
- `note` is allowed on any object, for intent. There are no comments in JSON.
- Keys starting with `x-` are extensions. Any other unknown key is an error.

## Vocabulary

| Kind | Allowed |
|---|---|
| Properties (`target.property`) | `x`, `y`, `width`, `height` (logical units: number or `"20px"`/`"pt"`/`"dp"`), `scale`, `scaleX`, `scaleY`, `rotation` (degrees), `opacity` (0–1), `color` (hex `#RGB`, `#RRGGBB`, `#RRGGBBAA`) |
| Events (`target.event`) | `down`, `up`, `cancel`, `tap`. A click is `down`, `up`, `tap`. |
| Time | seconds (`0.3`) or `"300ms"` |

Not nudg names: `translateX` (use `x`), `rotate` (`rotation`), `backgroundColor` / `fill` (`color`), `click` (`tap`), `press` (`down`).

## Motion

A motion is an object with exactly one of `spring` or `tween`, or the name of a motion defined in `motions` or an imported library.

- `spring` — one form only:
  - `duration` + `bounce` (preferred). `bounce`: 0 = no overshoot, 0.15 subtle, 0.3 lively, 0.5+ bouncy; negative = sluggish; must be < 1.
  - `response` + `dampingFraction`; `stiffness` + `dampingRatio`; `stiffness` + `damping` (+ `mass`).
  - Not `tension`/`friction` (ambiguous across tools).
- `tween` — `duration` and `ease`: `linear`, `in`, `out`, `in-out` (default), `in-`/`out-`/`in-out-` + `sine`, `quad`, `cubic`, `quart`, `quint`, `expo`, `circ`, `back` (e.g. `out-cubic`), or `[x1, y1, x2, y2]`.
- `kick` — velocity (units/second) added on state entry without changing the target; always with a `spring`. Only in a state's `enter`, only on numbers. `{ "kick": 6, "spring": { "duration": 0.4, "bounce": 0.5 } }` on `scale` pops; `{ "kick": -400, "spring": { "duration": 0.25, "bounce": 0.7 } }` on `x` shakes.

## Structure

- Machine: `initial` + `states`, or `regions` (named machines that run in parallel). States can nest a machine.
- State: `set`, `enter` (kicks on entry through a transition; not on first load), `when` (event → sibling state, or `{ "to": "...", "animate": { ... } }` to override motion for that transition).
- Two parallel regions may not set the same property.
- Named motions: `"motions": { "snappy": { "spring": { "duration": 0.3, "bounce": 0.15 } } }`, then use `"snappy"` anywhere a motion goes. `"import": ["./motion/brand.nudg.json"]` brings in another file's named motions (paths relative to the file). A name defined twice is an error.

## Drag and derived values (format 0.2)

Declare `"nudg": "0.2"` to use these.

```json
"values": {
  "knob.x": 0,
  "track.color": { "map": "knob.x", "from": [0, 20], "to": ["#D1D5DB", "#4ADE80"] }
},
"states": {
  "off": { "when": { "track.dragstart": "dragging" } },
  "on": { "set": { "knob.x": 20 }, "when": { "track.dragstart": "dragging" } },
  "dragging": {
    "follow": { "knob.x": { "input": "track.drag.x", "range": [0, 20], "overdrag": 0.3 } },
    "when": { "track.dragend": { "nearest": ["off", "on"], "by": "knob.x" } }
  }
}
```

- Events `dragstart` (after 4 units of travel) and `dragend`; inputs `target.drag.x` / `target.drag.y` (travel since `down`). A drag never ends in a `tap`.
- `follow` (in a state): the property tracks an input from wherever it was, with optional `range` and `overdrag` (0 = hard stop, 1 = no resistance). Numeric properties only; not also in that state's `set`. On leaving, the spring starts with the finger's velocity.
- `nearest` (a transition): `{ "nearest": [states], "by": "prop", "momentum": 0.5 }` goes to the listed sibling whose target for `by` is closest to its value plus velocity × `momentum` seconds. Ties go to the first listed.
- `map` (in `values`): `{ "map": "source.prop", "from": [points], "to": [values] }`, piecewise linear, held at the ends; colors blend in OKLab. A mapped property can't be set, animated, followed or kicked.
- `when` next to `states` (or inside a region) handles events no active state handles: N tabs need N entries.
- More events: `hoverstart`, `hoverend`, `focus`, `blur`, and `host.<name>` for events the app sends (a controlled toggle's `host.check`). `host` can't be a target name.

## Platform motion

Libraries in `examples/motion/` carry the platforms' published spring values: `apple.nudg.json` (SwiftUI `smooth`, `snappy`, `bouncy`), `material-expressive.nudg.json` and `material-standard.nudg.json` (Material 3 `spatial-*` and `effects-*` tokens). Every platform library also defines the common names `standard`, `quick`, `gentle`, `playful` and `fade` (for color and opacity).

- Default to the common names, so changing the import changes the platform feel.
- Use a native name only when the user asks to match a platform preset exactly ("use iOS's snappy spring").
- "Make it feel like Android / Material" or "like iOS": change the `import` line, keep the file.

## Words to edits

| Request | Edit |
|---|---|
| bouncier, more playful | raise `bounce` (e.g. 0.25 → 0.4) |
| less bouncy, calmer, no overshoot | lower `bounce`; 0 for none |
| faster, snappier | lower `duration` (e.g. 0.35 → 0.25) |
| slower, softer, more relaxed | raise `duration`; optionally lower `bounce` |
| pop, punchier feedback | add or raise a `kick` on `scale` in the state's `enter` |
| shake on error | `enter` kick on `x` with high `bounce` |
| change it everywhere | edit the shared motion library, not each file |
| make it draggable | add a `dragging` state with `follow`, entered on `dragstart`, left on `dragend` with `nearest` |
| harder to pull past the end | lower `overdrag` (0 stops dead) |
| easier to flick across | raise `momentum` (e.g. 0.5 → 0.8); lower it to rely on position |
| fade or tint with the drag | `map` the opacity or color from the dragged property |
| feel like iOS / Android | import `motion/apple.nudg.json` / `motion/material-expressive.nudg.json` and use the common names |

Change one thing at a time, then compare `nudg_plot` (overshoot `max`, `at rest` time) before and after.

## Tools

- `nudg_validate` — errors carry a `code`, a JSON pointer `path`, and a `hint` that says how to fix them. Apply the hint and validate again.
- `nudg_simulate` — send events at times, get states and values over time plus a per-property summary (`min`, `max`, `final`, `settledAt`). A whole drag is one item: `{ "drag": "track", "t": 0.1, "until": 0.3, "dx": 20 }`.
- `nudg_plot` — a motion graph image: properties over time with events, targets, overshoot and settle times.
- `nudg_render` — real frames of the component from the host page's markup and styles, as one filmstrip image.
