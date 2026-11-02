# nudg compared

Draft. This page is written from measurements, and it grows as they do. The README links here once the native comparisons below are done. How each number was taken is in the [devlog](devlog.md).

## The web bottom sheet, against Motion

The same bottom sheet, built with Motion (`motion/react`: drag with elastic bounds, a snap projected from release velocity, the backdrop mapped from position) and with nudg (the [example file](../examples/bottom-sheet.nudg.json) and a 13-line component). Checked in Chrome, both rest at the same points for open, a slow drag and a flick, with nearly the same spring curve.

| | Motion | nudg |
|---|---|---|
| Added to React's 68.6 kB, gzipped | 48.6 kB (also with `LazyMotion`) | 13.6 kB |
| Under `prefers-reduced-motion` | plays the full spring | a 0.15 s tween |
| Same file on iOS, Android, React Native | no | yes |

**Agents edit both correctly.** Claude made the same four edits to each version, three times each: a fourth snap point, a bouncier spring, Escape to close, a darker backdrop. In the latest rounds, every edit to either version passed. Correctness is not the difference.

**The difference is what the person judges with.** The Motion agent ends with the edit made and not looked at. With nudg's skill, the agent ends by showing the change. It opens both versions side by side in the browser, playing in a loop with slow motion, and says what changed ("overshoots 6.6 px where it barely did; settles 0.36 s later; the half-open backdrop gets darker too").

**Where nudg loses: turns.** That loop costs the agent turns. An edit with nudg's skill takes 11.0 turns, down from 14.2 after the fixes the transcripts pointed to. An edit with Motion takes about 5. Most of the gap is fixed overhead, loading the skill and the tools, plus the comparison itself, which is the step that shows the person.

## React Native performance

A release build ran on an Android emulator on an idle machine, with spinners animating at once. The numbers are JS frames a second.

| Spinners | nudg | Animated, JS-driven | Animated, native driver |
|---|---|---|---|
| 60 | 25.5 | 26.2 | 30 (the emulator's ceiling) |
| 150 | 6.3 | 8.2 | 30 |

nudg computes frames in JS, as JS-driven Animated does, and runs at about its speed. Before a fix in 1.5.1 it ran at half that speed. The native driver is faster when dozens of views move at once. nudg doesn't use it yet; that is an [open question](design.md#open-questions).

## Not measured yet

- React Native against Reanimated, and SwiftUI and Compose against their own animation APIs: code size, parity across platforms, agent turns per judged change.
- Accessibility by default on native. VoiceOver, TalkBack and React Native's screen readers activate and adjust nudg targets. That is checked, but not yet against what the platform libraries give without extra code.

Where nudg loses becomes the [roadmap](roadmap.md)'s queue. Where it wins becomes the message.
