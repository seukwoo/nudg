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
- `keyframes` (format 0.8) — intermediate values played on state entry. The current value at 0 and state target at 1 are implicit; list `{ "at", "value" }` points strictly between them with a positive `duration` and optional `ease`.

## Structure

- Machine: `initial` + `states`, or `regions` (named machines that run in parallel). States can nest a machine.
- State: `set`, `enter` (kicks or keyframes on entry through a transition; not on first load), `when` (event → sibling state, or `{ "to": "...", "animate": { ... } }` to override motion for that transition).
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
- **Reduced motion** is a runtime option (`reducedMotion: true`; the DOM adapter follows `prefers-reduced-motion`; CLI/MCP `--reduced-motion`): springs and tweens become 0.15 s linear tweens; kicks and entry keyframes are skipped. Don't put it in the file.

## Layout: measured values (formats 0.4 and 0.6)

When a value depends on the page (an underline under a tab whose width depends on its label, a panel that opens to its content), don't guess a number: measure it. The host reports each target's box; the file names what it needs.

- `{ "measure": "tab2.x" }` on `underline.x` moves the underline to where tab2 is (positions align: x into `.x`, y into `.y`).
- `{ "measure": "tab2.width" }` on `underline.width` takes tab2's width. `{ "measure": "panel.naturalHeight" }` on `panel.height` opens to the content (`naturalWidth`/`naturalHeight` are CSS's `auto`).
- Works in `values` and in a state's `set`; basic measurement needs `"nudg": "0.4"`.
- Format 0.6 adds optional arithmetic: `{ "measure": "sheet.height", "times": 0.5, "plus": -16 }`. The measured size or aligned position is multiplied first, then the logical-unit offset is added. `times` defaults to 1 and `plus` to 0.
- When the page relayouts (resize, font, longer label), the value moves to the new place with its usual motion. The DOM adapter measures and re-measures by itself.
- To simulate or compare without a page, pass what the page would measure: `layout: { "tab2.x": 96, "tab2.width": 88, "underline.x": 8 }` (CLI `--layout tab2.x=96,...`). Tools say which measurements are missing.
- Prefer measuring to hard-coding whenever a number would come from the layout: tab bars, accordions, swipe actions as wide as their labels, sheets sized by their content.

## Continuous app and scroll inputs (format 0.5)

Use a number supplied by the app without inventing frame-by-frame events. The app calls `player.input("host.volume", 0.7)`; files read the latest value with the existing operators.

- Map it directly: `"ring.scale": { "map": "host.volume", "from": [0, 1], "to": [1, 1.6] }`.
- Follow it while a state is active: `"follow": { "card.rotation": { "input": "host.tilt", "range": [-8, 8] } }`.
- On the DOM, a referenced `target.scroll.x` or `target.scroll.y` is reported automatically from the bound scrolling element.
- Before the first sample an input is 0. Only referenced inputs are accepted. Use one descriptive `host.<name>` segment; the app owns microphones, sensors and downloads, while nudg only receives finite numbers.

## Pausable timers (format 0.7)

When an auto-dismiss or control timeout must preserve the person's remaining time, make the timer transition an object with independent `pause` pairs:

```json
"after:3s": {
  "to": "hidden",
  "pause": [
    { "on": "toast.hoverstart", "off": "toast.hoverend" },
    { "on": "toast.focus", "off": "toast.blur" },
    { "on": "host.suspend", "off": "host.resume" }
  ]
}
```

The first active reason freezes the remaining duration and the last matching `off` resumes it. Re-entering the state resets both the timer and its pause reasons. Put `pause` only on an `after:` transition.

## Entry keyframes (format 0.8)

Use keyframes for a precisely authored transient response, such as a multi-beat validation shake:

```json
"enter": {
  "field.x": {
    "keyframes": [
      { "at": 0.2, "value": -10 },
      { "at": 0.45, "value": 8 },
      { "at": 0.7, "value": -5 }
    ],
    "duration": 0.4,
    "ease": "linear"
  }
}
```

The current value is implicit at 0 and the state's target is implicit at 1. Re-entry restarts from the current position; interruption hands the current velocity to the next ordinary motion. Keep keyframes inline under `enter`; use a kick when a physical impulse is enough.

## Measured follow and map endpoints (format 0.9)

Reuse a measured layout value where a drag bound or map source point would otherwise duplicate a pixel constant:

```json
"action.opacity": {
  "map": "content.x",
  "from": [0, { "measure": "action.width", "times": -1 }],
  "to": [0, 1]
},
"follow": {
  "content.x": {
    "input": "content.drag.x",
    "range": [{ "measure": "action.width", "times": -1 }, 0],
    "overdrag": 0.25
  }
}
```

Endpoints use the same `measure`, `times` and `plus` fields as state targets. Until all endpoint measurements arrive, a follow is unbounded and a map keeps its base; the first complete report applies immediately, and relayout updates the endpoints without restarting the drag.

## Platform motion

Libraries in `examples/motion/` carry the platforms' published spring values: `apple.nudg.json` (SwiftUI `smooth`, `snappy`, `bouncy`), `material-expressive.nudg.json` and `material-standard.nudg.json` (Material 3 `spatial-*` and `effects-*` tokens). Every platform library also defines the common names `standard`, `quick`, `gentle`, `playful` and `fade` (for color and opacity).

- Default to the common names, so changing the import changes the platform feel.
- Use a native name only when the user asks to match a platform preset exactly ("use iOS's snappy spring").
- "Make it feel like Android / Material" or "like iOS": change the `import` line, keep the file.

## Semantic UI words

When a person describes UI in natural language, call `nudg_recipe` (or `nudg recipe <term>`) before writing the file. It resolves aliases to a versioned mobile-first contract with expected parts, states, events, inputs, host responsibilities, motion, known gaps and a validated starter. Then express any requested variation with ordinary nudg fields.

Some recipes have no starter (`"starter": null`): menus, speed dials, animated lists, spinners, skeletons, typing indicators, hide-on-scroll bars, stack navigation, full-screen modals, shared-element transitions, drawers, image viewers and free-scrolling carousels. Their contract is still the standard answer: use its parts, states and events, write the nudg file for what the format can express (a menu's open and close, a drawer's drag), and tell the person which part the host does and why, from `gaps`. Don't imitate a missing capability with timers or extra states; that is the workaround the gap records.

| User says | Prefer |
|---|---|
| FAB, floating action button | primary floating action; targets `root`, `icon`, optional `label`; press feedback; optional hidden/expanded states |
| tab, tabs, tab bar | selected state; `tab.*.tap` events; indicator `x` / `width`; keyboard support when focusable |
| bottom sheet, sheet | `hidden`, `peek` / `expanded`; `sheet.dragstart`; `follow` on `y`; `nearest` snap; backdrop opacity mapped from sheet position |
| toast, snackbar | `hidden` / `shown`; enter motion; pausable `after:<time>` dismiss; optional action tap; exit presence in the host |
| swipe row, swipe actions | `content.x` follows drag; action opacity maps from `content.x`; `nearest` open/closed or dismiss |
| list, grid, card list | item press/hover, insertion/removal, reorder or responsive collection behavior; keep the item pattern separate from the collection layout |
| carousel, pager | drag on content, snap to neighbor, page indicator, optional momentum limit |
| text field, input | `field.focus` / `field.blur`; label floats while focused or filled (`host.filled` / `host.empty`); active line on focus; error from `host.invalid` |
| checkbox, radio, chip | fill and mark on select; radio dots move between options with arrow keys; chips widen to make room for a check |
| rating, stepper, badge | rating fills up to the tapped star and pops it; stepper nudges the number and shakes at a limit; badge scales in and pops per `host.increment` |
| switch, toggle | tap and drag; knob follows input; color maps from knob position; keyboard activation |
| slider, range slider | drag, arrow keys with `step`, `commit` on release, value bounds |
| dialog, modal, popover | present/dismiss, backdrop or anchor, focus/escape behavior, exit presence |
| voice chat, audio call | join/connect, input level, mute/unmute, elapsed time, leave; the host owns microphone permission and stream lifetime |
| video call, video chat | voice-call controls plus camera on/off and front/rear switch; keep call, camera and microphone states independent |
| camera, capture | permission, photo/video mode, shutter or record/stop, front/rear switch, review and retake; the host owns media capture |
| music player, audio player | play/pause, stop, seek, elapsed/duration, volume/mute, playback speed and optional skip/repeat; the host owns audio playback |
| video player | music-player transport plus video surface, buffering, auto-hiding controls, fullscreen and picture-in-picture; the host owns media playback and platform APIs |
| app bar, toolbar, command bar | actions tied to the current view; show/hide or collapse on scroll only when the host supplies that input |
| bottom nav, navigation bar, navigation rail, drawer, side nav, GNB, LNB | navigation selection and indicator motion; do not treat navigation items as destructive actions |

Pattern words live in external recipe metadata, not core syntax. Every shipped example links to one recipe, and recipe gaps are the evidence for adding lower-level motion features. If a file needs extra intent, put it in `note` and keep stable target names (`sheet`, `scrim`, `handle`, `content`, `action`, `indicator`) so the next edit can find the right part.

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
| shake on error | format 0.8 `enter` keyframes on `x`; use a kick only for a less-authored physical wobble |
| change it everywhere | edit the shared motion library, not each file |
| make it draggable | add a `dragging` state with `follow`, entered on `dragstart`, left on `dragend` with `nearest` |
| harder to pull past the end | lower `overdrag` (0 stops dead) |
| easier to flick across | raise `momentum` (e.g. 0.5 → 0.8); lower it to rely on position |
| fade or tint with the drag | `map` the opacity or color from the dragged property |
| feel like iOS / Android | import `motion/apple.nudg.json` / `motion/material-expressive.nudg.json` and use the common names |
| hide it after N seconds | `"after:Ns": "<state>"` in that state's `when`; use a 0.7 transition object with `pause` pairs when reading or interaction must freeze the timeout |
| keyboard support (arrows, Escape) | `target.key.arrowright` etc. in `when`; `step` for values, a `to` for states |
| make it stay where I drop it | `"commit": ["prop"]` on the transition that leaves the `follow` |

Change one thing at a time, then call `nudg_compare` with the version before and after and pass its headline on.

**Tuning feel with a person:** small changes are often below what a display can show (under a device pixel, under about three frames), and the person can't judge what they can't see. When `nudg_compare` says *imperceptible* or *subtle*, show an **exaggerated version first** (about 2–3× the change) so the direction is obvious, get a yes or no on the direction, then dial it back to taste. Say what you did: "this is exaggerated so the direction is clear; the real change will be about a third of this."

## Tools

- `nudg_validate` — errors carry a `code`, a JSON pointer `path`, and a `hint` that says how to fix them. Apply the hint and validate again.
- `nudg_simulate` — send events at times, get states and values over time plus a per-property summary (`min`, `max`, `final`, `settledAt`). A whole drag is one item: `{ "drag": "track", "t": 0.1, "until": 0.3, "dx": 20 }`.
- `nudg_plot` — a motion graph image: properties over time with events, targets, overshoot and settle times.
- `nudg_render` — real frames of the component from the host page's markup and styles, as one filmstrip image.
- `nudg_critique` — **is the motion good?** Run it once after writing or changing a file and fix the warnings before you show the person: transitions that take too long, press feedback that arrives late, changes nobody can see, fades that bounce, exits slower than entrances, short auto-dismiss, dialogs without Escape. Suggestions are judgment calls; mention them.
- `nudg_generate` — after adding or renaming targets, events, inputs or states in a file a TypeScript host uses, regenerate its contract module (`x.nudg.ts` beside `x.nudg.json`) with the returned text or `nudg generate <file>`, and use it as the adapter's type argument: `useNudg<XContract>(x)`.
- `nudg_share` — **when a change took several rounds.** `nudg_compare` tells you when a change reaches three rounds; ask the person once whether they'd share what made it hard. If yes, call `nudg_share` with their words as `note` and give them the link (a prefilled GitHub issue, counts only, which they submit). Never say it was sent.
- `nudg_observe` — **host truth.** The file says what should happen; this opens the real page (its scripts run), taps or presses the element, measures it every frame, and judges the page against the file: played, differs, never shown (the element left the page mid-motion), or nothing moved (not bound, or the tap doesn't reach it). Call it after wiring a file into an app, and whenever the person says it doesn't look right in the app: the file can be perfect while the page never shows it.
- The "before" is what git has: call `nudg_compare` with `file` and `before: "HEAD"` after editing, instead of keeping a copy of the old version. Use `{ file, rev }` on `a` or `b` for any other pairing.
- When the app is running, pass its `url` to `nudg_compare` instead of an `html` file: the component is snapshotted from the page and the before/after opens in the person's browser by itself (once; later calls rewrite the same page, so ask them to reload). Say in one sentence what the headline says, and which side is which: the result text names them.
- `nudg_compare` — **call this whenever you change motion for a person**, with the version before and after. It says first whether anyone would notice (imperceptible / subtle / clear), then shows both side by side: real A/B filmstrips when the host page's `html` is given, otherwise both curves on one graph. With `html` (both versions as files) it also writes a page that plays both versions side by side in slow motion; its path is in the result. Tell the person to open it, since stills can't show motion. Pass the headline on; if it proposes an exaggerated version, offer that. The person judges by looking, not by reading numbers.
