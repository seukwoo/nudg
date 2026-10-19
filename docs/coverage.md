# Coverage

Interactions are combinations, so nudg's reach is measured by what each part of the format can express, not by how many components have an example. Every interaction is some **trigger**, some **response**, inside some **structure**. This page lists each, whether the format supports it, and which example shows it; empty cells are the next examples to write or the next features to design. Scheduling lives in the [roadmap](roadmap.md).

Legend: **yes** supported, with an example; **yes, no example** supported but not yet shown; **partly** works with a workaround; **no** needs a format change (linked to the open question or proposal).

## Triggers: what starts or drives a change

| Trigger | Status | Shown in |
|---|---|---|
| Tap, press and release, cancel | yes | toggle, button-press, like |
| Drag along x or y (follow the finger, throw) | yes | toggle-drag, swipe-row, bottom-sheet, carousel, slider |
| Hover in and out | yes | hover-card, tooltip |
| Focus and blur | yes, no example | |
| Keys | yes | slider, dialog |
| Time (auto-dismiss, delays, pause/resume reasons) | yes | toast, tooltip, video player |
| Events from the app (`host.*`) | yes | toast, pull-to-refresh, shake, voice chat, video call, camera, music player, video player |
| A library's own state (`data-state`, `aria-*`) | yes, no example in the site | tested with MUI and Radix |
| Layout (sizes and positions on the page) | yes | tabs, accordion |
| Long press, double tap | partly: a state entered on `down` with an `after:` timer | |
| A continuous value from the app (a microphone level, media progress, a tilt, a download's progress) | yes | voice chat, music player, video player |
| Scroll position | yes | scroll-header |
| Scroll direction | no: direction events remain in the [proposal](design.md#proposal-continuous-app-inputs) | |
| Pinch, rotate (two fingers) | no: [open question](design.md#open-questions) | |

## Responses: how values move

| Response | Status | Shown in |
|---|---|---|
| Spring (duration and bounce, or stiffness and damping) | yes | most examples |
| Tween (named curves, Bézier) | yes | accordion, toast |
| Kick (a physical impulse on entering a state) | yes | like |
| Entry keyframes (authored multi-beat feedback) | yes | shake |
| Follow an input, with rubber banding | yes | toggle-drag, swipe-row |
| Snap to the nearest state, with momentum | yes | toggle-drag, carousel, segmented |
| Derived values (`map`), including colors | yes | toggle-drag, swipe-row |
| Stepping and keeping a value (`step`, `commit`) | yes | slider |
| Measured targets (`measure`) | yes | tabs, accordion |
| Reduced motion | yes, runtime-wide | every example |
| Continuous motion while a state is active (a spinner, a marquee) | partly: CSS through `data-nudg-state` | pull-to-refresh |
| Sequence, delay, stagger (menu items one after another) | no: [open question](design.md#open-questions) | |
| Decay (a fling that slows down without a snap point) | no: [open question](design.md#open-questions) | |
| Arithmetic on measurements (an offset, half a sheet) | yes | bottom-sheet, swipe-row |

## Structure: how states fit together

| Structure | Status | Shown in |
|---|---|---|
| States and transitions | yes | every example |
| Transitions from any state | yes | segmented, tabs |
| Nested states | yes, no example in the site | conformance: nested-states |
| Parallel regions (independent controls beside a primary state) | yes | toggle-press, video call |
| Presence (stay until the exit has played) | yes, in the adapters | toast |
| Several components coordinated (a list's items, a screen and its sheet) | no: stage 2 in the [roadmap](roadmap.md) | |
| Transitions across levels (into a nested state, out to a parent's sibling) | no: [open question](design.md#open-questions) | |

## Where it runs

| Host | Press, drag, keys | Layout | Checked |
|---|---|---|---|
| DOM | yes | yes | Chrome, every test run |
| React (and MUI, Radix, shadcn/ui, Headless UI, React Aria) | yes | yes | Chrome, with real MUI and Radix |
| React Native | press and drag | `onLayout` | Android emulator |
| SwiftUI | yes | `.nudgLayout` | conformance suite, SwiftUI render; iOS simulator waits for Xcode |
| Jetpack Compose | yes | `nudgLayout` | conformance suite, Android emulator |
