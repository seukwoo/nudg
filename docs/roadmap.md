# Roadmap

nudg 1.0 is stable: within 1.x, files and APIs only gain. The development direction is clear: make natural-language UI building produce standard, mobile-quality interactions instead of one-off motion guesses.

This is the single development plan for priorities, stage status and completion criteria. It consolidates the stages previously listed in the README and design doc, and the next steps previously kept in `CLAUDE.md`. Design rationale and unresolved technical choices stay in [Design](design.md#open-questions); implemented behavior is defined by [the spec](spec.md), and release history stays in the [changelog](../CHANGELOG.md). The [devlog](devlog.md) records findings at the time, not the current queue.

The order below follows real app needs. Release numbers and dates are assigned when scope is established; the earlier 0.6-0.9 headings were provisional. Package and format versions are separate: package 1.2.0 ships format 1.1.

## Current Baseline

| Work | Status | Evidence |
|---|---|---|
| States, motion, gestures, timers, keyboard events, reduced motion; DOM and React adapters | Implemented through format 0.3 | [Spec](spec.md), [usage](usage.md) |
| Press, hover, toggle and toast presets; platform motion libraries | Implemented | [Agent guide](../spec/guide.md#presets), [usage](usage.md#native-feel-on-every-platform) |
| `compare` and `observe` | Released | [Changelog](../CHANGELOG.md) |
| Exit/presence handling and live A/B in the playground | Released in package 0.5.0; the old next-step note is complete | [Changelog](../CHANGELOG.md#050) |
| Semantic UI recipes | Versioned contracts cover every shipped example; CLI and MCP resolve names and aliases to contracts and starters | [Recipe catalog](../recipes/index.json), [agent guide](../spec/guide.md#semantic-ui-words) |
| AI editing contract | Versioned JSON Schemas, a published agent guide, MCP tools and an installable agent skill ship with the package | [Package exports](../package.json), [agent guide](../spec/guide.md), [usage](usage.md#skill) |
| Headless renderer bridge | `createPlayer` accepts events and inputs and emits state/values; DOM and native adapters are consumers of the same core | [Design](design.md#any-platform), [usage](usage.md#headless-renderer-bridge) |
| Continuous app and scroll inputs | Implemented in format 0.5; the headless and DOM players and the React and React Native hooks expose `input` | [Spec](spec.md#inputs), [usage](usage.md#react-adapter) |
| Layout measurement and natural size | Implemented in format 0.4 | [Spec](spec.md#layout-inputs) |
| Layout arithmetic and relative measured values | Released in package 0.9.0 as format 0.6 | [Spec](spec.md#measured-values) |
| Measured follow/map endpoints | Released in package 0.10.0 as format 0.9; bottom sheet and swipe row no longer duplicate layout bounds | [Spec](spec.md#measured-values) |
| Pausable timers | Released in package 0.9.0 as format 0.7; TypeScript, Swift and Kotlin share conformance | [Spec](spec.md#timers) |
| Entry keyframes | Released in package 0.9.0 as format 0.8; TypeScript, Swift and Kotlin share conformance | [Spec](spec.md#entry-effects) |
| Loops while a state is active | Implemented as format 0.10 in 0.12.0; spinner, skeleton and typing indicator have starters | [Spec](spec.md#loops) |
| Screen transitions (stack, full-screen modal, shared element, drawer) | Implemented as one player with roles plus format 0.11 measured map values in 0.12.0 | [Design](design.md#screen-transitions-are-one-player-with-roles-format-011) |
| Sequence and stagger | Implemented as format 0.12 motion delay in 0.12.0; menu and speed dial have starters | [Design](design.md#sequence-and-stagger-are-a-delay-per-property-format-012) |
| Host declaration | Implemented as format 0.13 in 0.12.0: declared app events and inputs, checked by the validator and used by `nudg generate` | [Design](design.md#the-host-declaration-not-a-store-format-013) |
| Long press and double tap | Implemented as format 0.14 in 0.13.0, derived by the runtime | [Spec](spec.md#derived-gestures) |
| Crossings and scroll direction | Implemented as format 0.15 in 0.13.0; hide-on-scroll has a starter | [Spec](spec.md#events-from-inputs) |
| Pinch zoom | Format 0.18 pinch events and inputs, multiplying follows in 0.14.0; image viewer has a starter | [Design](design.md#pinch-two-pointers-and-a-multiplying-follow-format-018) |
| Animated list | One player per row plus format 0.17 input targets in 0.14.0 | [Design](design.md#a-list-is-one-player-per-item-format-017) |
| Decay | Implemented as format 0.16 `glide` in 0.13.0; free-scrolling carousel has a starter | [Design](design.md#glide-decay-with-the-same-momentum-as-nearest-format-016) |

## Product Stages

The original stage numbers remain useful when reading the spec and changelog. Semantic patterns apply across component and screen work; they extend those stages.

| Stage | Scope | Examples and needs | Status |
|---|---|---|---|
| 0 | Single element | Toggle, button, like; states, transitions, springs, DOM adapter | Implemented |
| 1 | Component | Tabs, accordion, swipe row, carousel, bottom sheet; coordinated targets, gestures, React adapter | Measurement, arithmetic, measured follow/map bounds and glide (0.16) implemented |
| 2 | Screens and flows | Onboarding, modals, screen transitions, list/grid coordination; data inputs and machine composition | Planned; nested states and a dialog example already exist |
| 3 | Native | iOS and Android; React Native, SwiftUI and Compose adapters plus matching runtimes | Initial platform support implemented; 0.10.0 carries format 0.9 and the same lifecycle (exit, settle) across all runtimes |
| 4 | Standalone content | Physics, canvas, game-like scenes; host rendering and physics integration | Exploratory |

## Completed: Deepen Motion From Recipe Evidence

Status: the first repeated lower-level gaps from the versioned recipe catalog are implemented across all runtimes. Broad catalog growth remains deferred.

- Done: format 0.6 layout arithmetic across TypeScript, Swift and Kotlin, with responsive bottom-sheet and swipe-row resting states.
- Done: format 0.7 pausable timers for toast dismissal and video-control auto-hide.
- Done: format 0.8 entry keyframes with interruption, relayout and reduced-motion rules shared across all three runtimes; validation feedback now uses them.
- Done: format 0.9 measured `follow.range` and `map.from` endpoints remove the remaining duplicated layout constants from bottom sheet and swipe row.
- Keep examples as executable evidence for recipes, not as a component-count target; do not widen the catalog without new evidence.
- Derived scroll direction (0.15) and decay (0.16 `glide`) followed later.

Completion met: the current recipes no longer duplicate essential measured resting points or rely on undocumented timer and multi-beat motion workarounds.

## Completed: Type-Safe Host Integration

Status: complete in 0.11.0 (`input` parity, `nudg generate`, `onSettle`, server-rendered first frame, the editing contract).

Goal: close the adoption gaps exposed by the existing format without adding component-specific runtime syntax.

- Done in 0.10.0: `nudg generate` validates the document and its imports and writes a types-only contract module of target names, handled events, continuous inputs and state paths; `--check` fails on missing or stale modules in CI. React, React Native, DOM and headless APIs take it as a type argument. Decisions in [Design](design.md#type-safe-host-contracts).
- Done in 0.10.0: format 0.5 `input(name, value)` through the React and React Native hooks. The React Native hook turned out to lack it as well; both keep the latest values across program changes and apply values given before mount.
- Done in 0.10.0: one portable settle notification, `onSettle`, in the headless and DOM players, React, React Native, SwiftUI and Compose, with the rest rule specified and covered by conformance. SwiftUI and Compose also gained `exit` / `onExit`. Decisions in [Design](design.md#settle-when-motion-is-over).
- Done in 0.11.0: server-rendered first frame. React `style(name)`, `initialStyles` / `cssText` for any server, and an `inputs` option; measured values render at their base. Hydration is checked in Chrome. Decisions in [Design](design.md#server-rendering-the-first-frame).
- Done: the published schema, validator codes, agent guide, recipes, skill and generated host names are documented as one [editing contract](usage.md#the-editing-contract-for-ai-tools), rather than a second prompt format.

Done when: a TypeScript host cannot misspell its generated target/event/input names, React can supply dynamic values without dropping to the DOM player, lifecycle completion means the same thing across adapters, and a server-rendered initial view hydrates without a visible jump.

## Completed: Recipe Coverage for Common App Patterns

Status: complete in 0.12.0 (formats 0.10 to 0.13). Screen composition turned out to need only measured map values (0.11), and sequence/stagger a motion delay (0.12). The declared `host` block followed as format 0.13, and long press and double tap as 0.14. Crossings and scroll direction followed as 0.15. Decay followed as 0.16 `glide`. The animated list followed with format 0.17 input targets and the image viewer with 0.18 pinches: every recipe in the catalog has a starter.

Goal: let an AI answer the common UI words of app development with a standard contract, and let the gaps decide the next motion primitive. The 22 recipes cover single components and media well; navigation, lists, loading, menus and form controls are missing.

- Done: add recipes the current format already expresses, each with a validated starter and an example: text field (focus, floating label, error), checkbox, radio group, chip / filter selection, rating, badge count bump, page indicator, stepper, expanding search bar.
- Done: register the patterns the format can't express yet as recipe contracts with gaps and no starter, so an AI gives a standard answer ("the host does this part") instead of improvising: dropdown / popover menu and FAB speed dial (sequence, stagger), list insert / remove / reorder (collection coordination), spinner, skeleton shimmer and typing indicator (continuous motion), hide-on-scroll navigation (scroll direction), stack push / pop, full-screen modal, shared-element and drawer transitions (screen composition), pinch-zoom image viewer (multi-pointer), free-scrolling carousel (decay).
- Done: gap-only contracts use `"starter": null` in catalog version 2, gap capabilities are a fixed list, and `nudg recipe` marks them and refuses `--source` with the gaps. Decisions in [Design](design.md#recipes-without-a-starter).
- Count gaps across the catalog (`nudg recipe --gaps`) and promote the most needed one into the queue below. After registration: screen composition 4, continuous motion 4 (one a workaround), sequence 3, stagger 3, decay 2, others 1. Sequence and stagger together cover four recipes. The nine starter recipes needed no new capability, so the counts stood.
- Done: continuous motion was promoted and implemented as format 0.10 loops; with `delay` it also covers the typing indicator's stagger. Then screen composition (4) was tried and needed only measured map values, format 0.11; its four recipes have starters. Then sequence and stagger became a per-property delay, format 0.12. Then scroll direction (0.15), decay (0.16), collection coordination (0.17) and multi-pointer (0.18) followed. No gaps remain.

Done when: the catalog names every pattern above, each either with a validated starter or with explicit gaps, and the queue's next primitive is chosen from the gap counts.

## Deferred: Prove the Workflow in Playsnack

Goal: find the cases where nudg is plainly better than ad hoc code or a one-line animation helper.

- Use nudg in playsnack where the interaction has real state: snack/toast presence, dismiss, drag, timers, shared motion libraries, or before/after tuning.
- Keep the simple case competitive with presets (`press`, `hover`, `toggle`, `toast`) and avoid adding plumbing for interactions that don't need nudg yet.
- Let evidence accumulate without asking anyone: a local judge log (`nudg log`, rounds per change) that users can attach to issues, and a Claude Code skill so agents run the loop unprompted. Field validation is open to whoever uses nudg; the roadmap does not wait on a particular app.
- Know what good motion is: `nudg critique` checks every transition against the platforms' motion guidelines and accessibility rules, so the agent fixes the obvious before the person looks.
- Harden the judge loop: after an AI changes motion, it should validate, compare, and show a live A/B page without being asked. Done for the first steps: `nudg_compare` takes the running app's `url`, snapshots the component and opens the before/after in the browser, and `before: "HEAD"` supplies the old version from git so nothing is copied. Next: record one real playsnack session as a "turns: N" case.
- Improve `observe` from field reports, because the real app is the source of truth.
- Add examples that show the say -> see -> judge loop, not only static JSON snippets.
- Exercise semantic recipes in real prompts and record contract corrections or missing motion capabilities in the recipe catalog.

Done when: a real playsnack interaction is easier to tune with nudg than by editing component code, and the docs can point to that workflow honestly.

## Layout-Aware Foundation

Status: complete for the current component recipes. Format 0.4 measures positions and sizes, format 0.6 adds arithmetic, and format 0.9 reuses measurements in `follow.range` and `map.from`.

Goal: support the component patterns whose motion depends on measured size or position.

- Done: measured tab indicator position and width, accordion natural height, bottom-sheet snap states, and swipe-row resting width.
- Done: portable fractions and offsets through format 0.6 `times` and `plus`, with cross-runtime conformance.
- Done: measured endpoints let `follow.range` and `map.from` reuse the same layout values as resting states.

Completion met: `tab-bar`, `accordion`, `bottom-sheet`, and `swipe-row` no longer need hard-coded pixel guesses for their essential behavior.

## Queue Details

Goal: deepen the interaction and motion language where current recipes demonstrably run out of vocabulary.

| Candidate | Evidence in current recipes | Decision gate |
|---|---|---|
| Layout arithmetic and relative snap points | Bottom sheet and swipe row resting states, drag bounds and derived opacity depended on constants | Implemented across formats 0.6 and 0.9; current recipe gaps are closed |
| Pausable timers | Toast dismissal and video control auto-hide pause for focus, hover, scrubbing or app suspension | Implemented for format 0.7 with deterministic remaining-time semantics |
| Keyframes | Reaction bursts and authored validation shakes need more than one kick | Implemented for format 0.8 as transient entry effects with deterministic interruption and reduced motion |
| Sequence | Accordion, menu and speed dial | Implemented as format 0.12 motion delay |
| Decay | Free-scrolling carousel and image viewer pan | Implemented as format 0.16 `glide`, with the same momentum as `nearest` |
| Continuous active motion | Spinner, skeleton, typing indicator and pull-to-refresh | Implemented as format 0.10 loops, with wrap on exit and a per-loop delay |
| Scroll direction and velocity | App bars can map position but cannot hide on down and reveal on up | Generalize as derived continuous inputs, not a header-only feature |

For each promoted primitive: start with the recipe contract and conformance case, implement TypeScript, Swift and Kotlin parity, then update the starter and judge tooling. `stagger`, collection coordination and screen transitions wait until recipes for lists, grids or flows supply concrete evidence.

Done when: the highest-value current recipes no longer need duplicated layout constants or undocumented host animation, without turning nudg into a component library.

## Later: Screens, Flows and Richer Motion

Goal: deliver the original stage 2 scope with patterns proven in app workflows.

- Build onboarding, modal flows, screen transitions and collection insertion/removal/reorder examples. Use them to establish requirements for data inputs and composing machines beyond today's nested states.
- Done in format 0.16: decay as `glide`, for fling and scroll-like motion without snap points.
- Add small compositional primitives where real patterns need them: `delay`, `sequence`, or `stagger`.
- Explore reusable behavior composition for patterns such as toast = presence + timer + dismiss + hover pause.
- Done in format 0.10: loops for spinners, shimmers and typing dots. Marquees and loops that run a fixed number of times wait for a pattern.
- Keep every new primitive tied to at least one real pattern and one conformance case.

Done when: screen-level and collection-level interactions can be expressed without one-off host code for the motion logic.

Other existing candidates remain in [Design's open questions](design.md#open-questions), including cross-level transitions, a final-state marker, per-property reduced motion, discrete commit steps, nonlinear rubber banding, neighbor-limited snapping, gestures beyond a two-pointer pinch, motion overrides and schemes. They are retained design questions; a real pattern determines their priority.

## Completed: 1.0, Stable on Every Platform

Goal: a format and APIs other people can build on, on the web and natively, without churn. Decisions in [Design](design.md#10-what-is-stable).

- Done: format `"1.0"`: the semantics of 0.18, frozen. Runtimes keep reading every 0.x file; `nudg upgrade` rewrites a file's version after validating it. Schema 1.0; the examples and starters declare 1.0.
- Done: frozen surface, checked by tests: every validator error code listed with its meaning ([errors](errors.md)); the conformance suite; the schema; the compiled program format; the public API of `@nudg/core` and its entry points, the CLI and MCP tools, the Swift package and the Kotlin modules, each against a committed snapshot in `api/`.
- Done: one spec. The 0.x "Additions" sections are rewritten into a single [1.0 document](spec.md) organized by topic, with the [format history](spec.md#appendix-format-history) as an appendix.
- Done: native checked for real. The Swift tests (conformance, a pixel-checked SwiftUI render, lifecycle) run on an iOS simulator, in CI too; the Compose demo is driven with real touch on an Android 16 emulator (tap, drag, two-finger pinch); React Native's multi-touch handling has a unit test.
- Done in 1.0.0: the release, with the compatibility policy: within 1.x, files and APIs only gain; anything that breaks waits for 2.0.
- Revisit semantic role metadata in files only if external recipe metadata proves insufficient; external metadata is the current decision.

Done when: a user can adopt nudg in a production web, React, iOS or Android component and trust that the format and APIs will not churn under them.

Status: complete in 1.0.0.

## Now: After 1.0, Native and Beyond

Goal: make the same interaction intent portable beyond web.

- Done: activation is a tap on every platform. VoiceOver, TalkBack and React Native screen readers activate a target whose tap the file handles, as keyboards and screen readers do on the web; Compose follows the system's "Remove animations" as reduced motion. Checked on an iOS simulator and an Android emulator. Decisions in [Design](design.md#activation-is-a-tap-on-every-platform).
- Done: format 1.1, reduced motion keeps fades. Under reduced motion an opacity loop keeps playing, so a loading pulse keeps signalling; loops that move still stop. Found by playsnack's 0.12 review. Decisions in [Design](design.md#reduced-motion-keeps-fades-format-11).
- Done: judging on native. `nudg compare --bundle` (MCP `bundle`) writes a comparison that `NudgCompare` plays side by side on the app's own SwiftUI, Compose or React Native view, with the headline, a loop, mirrored taps and slow motion. Checked on an iOS simulator (live in a window) and an Android emulator (Compose, and React Native through Expo Go). Decisions in [Design](design.md#judging-on-native-the-comparison-travels-as-data).
- Harden native host guidance and accessibility behavior beyond what 1.0 checks.
- A portable core, possibly Rust/WASM/FFI, if maintaining multiple runtimes becomes expensive.
- Native-specific host guidance for focus, accessibility, gesture systems, and reduced motion.
- Flutter or React Native if dogfooding points there.
- Standalone / canvas / game-like scenes only after the UI pattern story is strong; this is where a future relationship with bite can become concrete.

## Guardrails

- Update priorities and completion status here; other documents link here instead of maintaining their own queues. Keep technical questions in Design and release details in the changelog.
- Start from mobile-quality patterns, but keep the core platform-neutral.
- Use playsnack to find reusable requirements. nudg has no dependency on playsnack or bite; their relationship remains exploratory.
- Prefer recipes and examples before adding new format fields.
- Keep platform accessibility semantics in the host and recipe contract; do not put web-only ARIA into the portable motion grammar.
- External renderers consume the headless player's values; the deterministic motion solver remains part of nudg so every runtime can pass the same conformance suite.
- Treat CSS-variable output as an optional DOM-adapter experiment only after real integration evidence; direct style writes remain the low-overhead default.
- Every new feature needs at least one real interaction, one conformance or regression test, and one way for the AI/person judge loop to inspect it.
- The person judges motion by seeing it. Graphs and numbers support the workflow; they are not the product.
