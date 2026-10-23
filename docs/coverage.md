# Coverage

Interactions are combinations, so nudg's reach is measured by what each part of the format can express, not by how many components have an example. Every interaction is some **trigger**, some **response**, inside some **structure**. This page lists each, whether the format supports it, and which example shows it; empty cells are the next examples to write or the next features to design. Scheduling lives in the [roadmap](roadmap.md).

Legend: **yes** supported, with an example; **yes, no example** supported but not yet shown; **partly** works with a workaround; **no** needs a format change (linked to the open question or proposal).

## Triggers: what starts or drives a change

| Trigger | Status | Shown in |
|---|---|---|
| Tap, press and release, cancel | yes | toggle, button-press, like |
| Drag along x or y (follow the finger, throw) | yes | toggle-drag, swipe-row, bottom-sheet, carousel, slider |
| Hover in and out | yes | hover-card, tooltip |
| Focus and blur | yes | text-field |
| Keys | yes | slider, dialog |
| Time (auto-dismiss, delays, pause/resume reasons) | yes | toast, tooltip, video player |
| Events from the app (`host.*`) | yes | toast, pull-to-refresh, shake, voice chat, video call, camera, music player, video player |
| A library's own state (`data-state`, `aria-*`) | yes, no example in the site | tested with MUI and Radix |
| Layout (sizes and positions on the page) | yes | tabs, accordion |
| Long press, double tap | yes: `longpress`, `doubletap` (0.14) | double-tap like |
| A continuous value from the app (a microphone level, media progress, a tilt, a download's progress) | yes | voice chat, music player, video player |
| Scroll position | yes | scroll-header |
| Scroll direction | yes: `scrollup`, `scrolldown` (0.15) | hide-on-scroll |
| A value crossing a threshold (louder than, scrolled past) | yes: `host.volume>0.6`, `list.scroll.y<24` (0.15) | hide-on-scroll |
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
| Measured targets and follow/map endpoints (`measure`) | yes | tabs, accordion, bottom-sheet, swipe-row |
| Reduced motion | yes, runtime-wide | every example |
| Continuous motion while a state is active (a spinner, a marquee) | yes: `loop` (0.10) | spinner, skeleton, typing indicator, pull-to-refresh |
| Sequence, delay, stagger (menu items one after another) | yes: `delay` on a motion in `animate` (0.12) | accordion, menu, speed dial |
| Decay (a fling that slows down without a snap point) | yes: `glide` (0.16) | free-scrolling carousel |
| Arithmetic on measurements (an offset, half a sheet) | yes | bottom-sheet, swipe-row |

## Structure: how states fit together

| Structure | Status | Shown in |
|---|---|---|
| States and transitions | yes | every example |
| Transitions from any state | yes | segmented, tabs |
| Nested states | yes, no example in the site | conformance: nested-states |
| Parallel regions (independent controls beside a primary state) | yes | toggle-press, video call |
| Presence (stay until the exit has played) | yes, in the adapters | toast |
| Two screens in one transition (push and pop, a modal over its presenter, a shared element, a push drawer) | yes: one player whose targets are roles, measured map values (0.11) | stack navigation, full-screen modal, shared element, drawer |
| A collection's items coordinated (insert, remove, reorder) | yes: one player per item, host-driven order, input targets (0.17) | animated list |
| Transitions across levels (into a nested state, out to a parent's sibling) | no: [open question](design.md#open-questions) | |

## Where it runs

| Host | Press, drag, keys | Layout | Checked |
|---|---|---|---|
| DOM | yes | yes | Chrome, every test run |
| React (and MUI, Radix, shadcn/ui, Headless UI, React Aria) | yes | yes | Chrome, with real MUI and Radix |
| React Native | press and drag | `onLayout` | Android emulator |
| SwiftUI | yes | `.nudgLayout` | conformance suite, SwiftUI render; iOS simulator waits for Xcode |
| Jetpack Compose | yes | `nudgLayout` | conformance suite, Android emulator |
