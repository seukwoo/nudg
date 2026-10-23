# Validator codes

Every diagnostic `nudg validate` (and `nudg_validate`) reports has a stable code, a JSON pointer to where it applies, and a hint that says how to fix it. The codes are part of the 1.0 contract: within 1.x a code is never renamed or reused for something else, and new codes may be added. Tools may match on codes; the messages and hints may be reworded.

Errors stop a file from compiling. Warnings don't.

## Errors

| Code | Means |
|---|---|
| `after-on-machine` | An `after:` timer is in a machine's `when`; timers belong to a state. |
| `delay-outside-animate` | A `delay` is on a named motion or an entry kick; it belongs to a motion in `animate`. |
| `duplicate-host-name` | A name is declared twice under `host`. |
| `duplicate-motion` | Two files define a motion with the same name. |
| `duplicate-target` | A target is listed twice. |
| `enter-effect-conflict` | An entry effect has both keyframes and a kick. |
| `enter-without-kick` | A motion in `enter` has no kick or keyframes. |
| `follow-conflict` | A property is followed and also set, or given an entry effect, in the same state. |
| `follow-not-numeric` | A color follows an input. |
| `glide-conflict` | A gliding property is also set, followed, looped or given an entry effect in the same state. |
| `glide-not-numeric` | A color glides. |
| `import-cycle` | Imports form a cycle. |
| `import-not-found` | An imported file doesn't exist. |
| `import-unavailable` | The file imports another but the caller gave `compile()` no way to read files. |
| `initial-with-regions` | A machine has both `initial` and `regions`. |
| `invalid-after` | An `after:` time isn't a time. |
| `invalid-bounds` | `min` / `max` aren't numbers, are on a color, or don't make a range. |
| `invalid-by` | `nearest`'s `by` isn't a numeric property the candidates set. |
| `invalid-commit` | `commit` lists a color or something that isn't a property. |
| `invalid-event` | An event key isn't `target.event`, `target.key.<name>`, `host.<name>` or an input crossing. |
| `invalid-keyframe-time` | Keyframe `at` values aren't strictly increasing inside (0, 1). |
| `invalid-keyframes` | `keyframes` isn't a list of `{ "at", "value" }` points. |
| `invalid-loop` | A loop has neither `to` nor `keyframes`. |
| `invalid-map` | A map's `from` or `to` points are missing, unordered or the wrong count. |
| `invalid-map-source` | A map's source is a color, mapped itself, or not a property or input. |
| `invalid-measure` | A measure names something that can't be measured, or measures into a color. |
| `invalid-measure-arithmetic` | A measure's `times` or `plus` isn't a finite number. |
| `invalid-name` | A target, state, motion or host name isn't a valid identifier. |
| `invalid-path` | A property path isn't `target.property`. |
| `invalid-step` | A `step` is on a color or isn't a number. |
| `invalid-timer-pause` | A timer's `pause` isn't a list of `{ "on", "off" }` events. |
| `invalid-type` | A value has the wrong JSON type for its place. |
| `invalid-value` | A value is out of its allowed domain (a negative duration, an overdrag above 1, a malformed range). |
| `json-parse` | The file isn't valid JSON. |
| `keyframes-outside-enter` | Keyframes appear outside a state's `enter`. |
| `kick-needs-spring` | A kick has no spring to carry the value back. |
| `kick-on-color` | A color is kicked. |
| `kick-outside-enter` | A kick appears in `animate`. |
| `loop-conflict` | A property loops and is followed in the same state. |
| `loop-not-numeric` | A color loops. |
| `machine-conflict` | An object has both `states` and `regions`. |
| `machine-when-regions` | A machine-level `when` sits next to `regions`. |
| `mapped-property` | A mapped property is set, animated, followed, kicked, looped or glided. |
| `missing-base` | A value with `min` / `max` has no `base`. |
| `missing-base-value` | A property is used without a base value in `values`. |
| `missing-duration` | Keyframes or a loop have no `duration`. |
| `missing-initial` | A machine with `states` has no `initial`. |
| `missing-machine` | A file has targets or values but no states. |
| `missing-motion-kind` | A motion has neither `spring` nor `tween`. |
| `missing-states` | A region has no states. |
| `missing-targets` | A component file doesn't list its `targets`. |
| `missing-to` | A transition object has no `to`, `nearest`, `step` or `commit`. |
| `missing-version` | The file doesn't declare `"nudg"`. |
| `motion-conflict` | A motion has both `spring` and `tween`. |
| `needs-version` | A feature is newer than the file's declared format; the hint names the version to declare. |
| `out-of-range` | A base or `set` value lies outside its property's `min` / `max`. |
| `region-conflict` | Two parallel regions set, follow, loop or glide the same property. |
| `reserved-name` | A target is named `host`. |
| `spring-ambiguous-form` | A spring uses `tension` / `friction`, which tools disagree on. |
| `spring-incomplete` | A spring form is missing a required parameter. |
| `spring-mixed-forms` | A spring mixes parameters from different forms. |
| `transition-conflict` | A transition has both `to` and `nearest`. |
| `undeclared-host-event` | With a `host` declaration, a `host.<name>` event isn't declared. |
| `undeclared-host-input` | With a `host` declaration, a `host.<name>` input isn't declared. |
| `unknown-ease` | An ease name isn't one of nudg's. |
| `unknown-event` | An event isn't a nudg event; the hint suggests the nearest. |
| `unknown-input` | An input isn't a drag, pinch, scroll or app input. |
| `unknown-key` | An object has a key nudg doesn't know; the hint suggests the nearest. |
| `unknown-motion` | A named motion isn't defined or imported. |
| `unknown-property` | A property isn't one of nudg's; the hint suggests the nudg name. |
| `unknown-state` | A transition targets a state that doesn't exist among its siblings. |
| `unknown-target` | A path or event names a target not in `targets`. |
| `unsupported-unit` | A length uses a unit nudg doesn't support (percent). |
| `unsupported-version` | `"nudg"` isn't a version this runtime reads. |

## Warnings

| Code | Means |
|---|---|
| `empty-file` | The file defines no machine and no motions. |
| `host-prefix` | A name under `host` is written with `host.` in front. |
| `outside-input-range` | A map point lies outside the range `host` declares for its input. |
| `unused-host-event` | A declared host event is handled nowhere. |
| `unused-host-input` | A declared host input is read nowhere. |
| `unused-target` | A target is declared but never used. |

## Critique findings

`nudg critique` checks motion against the platforms' guidelines rather than the format. Its findings are advice, not errors; their codes are stable in the same way, and new checks may be added.

| Code | Means |
|---|---|
| `bouncy-fade` | Opacity or color overshoots on a spring with bounce. |
| `invisible-change` | A transition moves something too little to see. |
| `late-feedback` | Press feedback starts too late to feel immediate. |
| `no-escape` | An overlay or dialog can't be closed with Escape. |
| `short-timeout` | Something dismisses itself before it can be read. |
| `slow-exit` | Leaving takes longer than entering, or longer than exits should. |
| `slow-transition` | A transition takes longer than the guidelines allow. |
