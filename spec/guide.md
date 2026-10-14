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

## Keys, timers, sliders, reduced motion (format 0.3)

Declare `"nudg": "0.3"` to use these.

- **Key events:** `target.key.<name>` while the target has focus: `space`, `enter`, `escape`, `tab`, `arrowleft/right/up/down`, `home`, `end`, `backspace`, `delete`, `pageup`, `pagedown`, single characters, `f1`–`f12` (lowercase `KeyboardEvent.key`). A native button still taps on Space/Enter by itself.
- **Timers:** `"after:3s": "hidden"` in a state's `when` fires that long after the state was entered, if it's still active; re-entering restarts it. Not on a machine's `when`.
- **`step` and `commit`** change a property's base value for good: `{ "step": { "thumb.x": 10 } }` adds (no `to` needed: stay in the state); `{ "to": "idle", "commit": ["thumb.x"] }` keeps the current value when leaving a `follow`. Both clamp to the property's bounds.
- **Bounds:** `"thumb.x": { "base": 0, "min": 0, "max": 200 }`. They clamp `step`/`commit`, default a `follow`'s `range`, and make an out-of-range `set` an error.
- **Reduced motion** is a runtime option (`reducedMotion: true`; the DOM adapter follows `prefers-reduced-motion`; CLI/MCP `--reduced-motion`): springs and tweens become 0.15 s linear tweens, kicks do nothing. Don't put it in the file.

## Platform motion

Libraries in `examples/motion/` carry the platforms' published spring values: `apple.nudg.json` (SwiftUI `smooth`, `snappy`, `bouncy`), `material-expressive.nudg.json` and `material-standard.nudg.json` (Material 3 `spatial-*` and `effects-*` tokens). Every platform library also defines the common names `standard`, `quick`, `gentle`, `playful` and `fade` (for color and opacity).

- Default to the common names, so changing the import changes the platform feel.
- Use a native name only when the user asks to match a platform preset exactly ("use iOS's snappy spring").
- "Make it feel like Android / Material" or "like iOS": change the `import` line, keep the file.

## Presets

`presets.press()`, `hover()`, `toggle()`, `toast()` (in `@nudg/core` and `@nudg/core/react`) return ready-made documents for the common cases, so a plain press needs no file: `useNudg(presets.press({ scale: 0.96 }))`. When a user wants more than the options cover, write the file: `nudg preset press > press.nudg.json` prints the same document, and then edit it like any nudg file.

## Words to edits

| Request | Edit |
|---|---|
| bouncier, more playful, 탱글하게 | raise `bounce` (e.g. 0.25 → 0.4) |
| heavier, weightier, 묵직하게 | raise `duration` a little (e.g. 0.3 → 0.4) and lower `bounce` (e.g. 0.3 → 0.1): slower to settle, no spring-back |
| chewy, 쫀득하게 | a little longer `duration` with a small `bounce` (0.15–0.25): it stretches, then lands |
| calmer, 차분하게 | `bounce` 0 and a longer `duration` |
| livelier, 경쾌하게 | shorter `duration`, a little more `bounce` |
| crisper, 날렵하게 | shorter `duration`, `bounce` near 0.15 |
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
| hide it after N seconds | `"after:Ns": "<state>"` in that state's `when` |
| keyboard support (arrows, Escape) | `target.key.arrowright` etc. in `when`; `step` for values, a `to` for states |
| make it stay where I drop it | `"commit": ["prop"]` on the transition that leaves the `follow` |

Change one thing at a time, then call `nudg_compare` with the version before and after and pass its headline on.

**Tuning feel with a person:** small changes are often below what a display can show (under a device pixel, under about three frames), and the person can't judge what they can't see. When `nudg_compare` says *imperceptible* or *subtle*, show an **exaggerated version first** (about 2–3× the change) so the direction is obvious, get a yes or no on the direction, then dial it back to taste. Say what you did: "this is exaggerated so the direction is clear; the real change will be about a third of this."

## Tools

- `nudg_validate` — errors carry a `code`, a JSON pointer `path`, and a `hint` that says how to fix them. Apply the hint and validate again.
- `nudg_simulate` — send events at times, get states and values over time plus a per-property summary (`min`, `max`, `final`, `settledAt`). A whole drag is one item: `{ "drag": "track", "t": 0.1, "until": 0.3, "dx": 20 }`.
- `nudg_plot` — a motion graph image: properties over time with events, targets, overshoot and settle times.
- `nudg_render` — real frames of the component from the host page's markup and styles, as one filmstrip image.
- `nudg_observe` — **host truth.** The file says what should happen; this opens the real page (its scripts run), taps or presses the element, measures it every frame, and judges the page against the file: played, differs, never shown (the element left the page mid-motion), or nothing moved (not bound, or the tap doesn't reach it). Call it after wiring a file into an app, and whenever the person says it doesn't look right in the app: the file can be perfect while the page never shows it.
- `nudg_compare` — **call this whenever you change motion for a person**, with the version before and after. It says first whether anyone would notice (imperceptible / subtle / clear), then shows both side by side: real A/B filmstrips when the host page's `html` is given, otherwise both curves on one graph. With `html` it also writes `compare.html`, which plays both versions side by side in slow motion; tell the person to open it, since stills can't show motion. Pass the headline on; if it proposes an exaggerated version, offer that. The person judges by looking, not by reading numbers.
