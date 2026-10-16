# Roadmap

nudg is early. The format can still change before 1.0, but the development direction is clear: make natural-language UI building produce standard, mobile-quality interactions instead of one-off motion guesses.

This is the single development plan for priorities, stage status and completion criteria. It consolidates the stages previously listed in the README and design doc, and the next steps previously kept in `CLAUDE.md`. Design rationale and unresolved technical choices stay in [Design](design.md#open-questions); implemented behavior is defined by [the spec](spec.md), and release history stays in the [changelog](../CHANGELOG.md). The [devlog](devlog.md) records findings at the time, not the current queue.

The order below follows real app needs. Release numbers and dates are assigned when scope is established; the earlier 0.6-0.9 headings were provisional. Package and format versions are separate: the package is currently 0.5.0, while documents use format 0.3. Earlier notes call the next grammar v0.4; its scope is still open.

## Current Baseline

| Work | Status | Evidence |
|---|---|---|
| States, motion, gestures, timers, keyboard events, reduced motion; DOM and React adapters | Implemented through format 0.3 | [Spec](spec.md), [usage](usage.md) |
| Press, hover, toggle and toast presets; platform motion libraries | Implemented | [Agent guide](../spec/guide.md#presets), [usage](usage.md#native-feel-on-every-platform) |
| `compare` and `observe` | Released; review fixes are in the unreleased changelog | [Changelog](../CHANGELOG.md) |
| Exit/presence handling and live A/B in the playground | Released in package 0.5.0; the old next-step note is complete | [Changelog](../CHANGELOG.md#050) |
| Semantic UI vocabulary | Initial guidance documented; reusable recipes remain planned | [Agent guide](../spec/guide.md#semantic-ui-words) |
| Layout measurement, natural size, relative units and decay | Open design work | [Open questions](design.md#open-questions) |

## Product Stages

The original stage numbers remain useful when reading the spec and changelog. Semantic patterns apply across component and screen work; they extend those stages.

| Stage | Scope | Examples and needs | Status |
|---|---|---|---|
| 0 | Single element | Toggle, button, like; states, transitions, springs, DOM adapter | Implemented |
| 1 | Component | Tabs, accordion, swipe row, carousel, bottom sheet; coordinated targets, gestures, React adapter | Core behavior implemented; layout measurement remains open |
| 2 | Screens and flows | Onboarding, modals, screen transitions, list/grid coordination; data inputs and machine composition | Planned; nested states and a dialog example already exist |
| 3 | Native | iOS and Android; SwiftUI and Compose adapters or code generation | Planned |
| 4 | Standalone content | Physics, canvas, game-like scenes; host rendering and physics integration | Exploratory |

## Now: Meet People Where Their Components Are

Status: the web bridges are in (unreleased): `watch` for libraries that show state as attributes (shadcn/ui and Radix, Headless UI, React Aria, Ark) and `nudgTransition` for transition slots (MUI, Ant Design, React Bootstrap). Beyond the web (unreleased): React Native (the JavaScript core as is), and Swift and Kotlin runtimes that read compiled programs (`nudg compile`) and pass the whole conformance suite, with SwiftUI and Jetpack Compose adapters. The same file plays on all of them; Android was checked on an emulator, SwiftUI by rendering, and an iOS simulator run waits for Xcode. Next: drag and keys on the native adapters, and package distribution (Swift Package, Maven). Then [coverage](coverage.md) by trigger × response × structure instead of component counts (its empty cells are the next examples), and continuous app inputs ([proposal](design.md#proposal-continuous-app-inputs)).

## Then: Prove the Workflow in Playsnack

Goal: find the cases where nudg is plainly better than ad hoc code or a one-line animation helper.

- Use nudg in playsnack where the interaction has real state: snack/toast presence, dismiss, drag, timers, shared motion libraries, or before/after tuning.
- Keep the simple case competitive with presets (`press`, `hover`, `toggle`, `toast`) and avoid adding plumbing for interactions that don't need nudg yet.
- Let evidence accumulate without asking anyone: a local judge log (`nudg log`, rounds per change) that users can attach to issues, and a Claude Code skill so agents run the loop unprompted. Field validation is open to whoever uses nudg; the roadmap does not wait on a particular app.
- Know what good motion is: `nudg critique` checks every transition against the platforms' motion guidelines and accessibility rules, so the agent fixes the obvious before the person looks (unreleased).
- Harden the judge loop: after an AI changes motion, it should validate, compare, and show a live A/B page without being asked. Done for the first steps (unreleased): `nudg_compare` takes the running app's `url`, snapshots the component and opens the before/after in the browser, and `before: "HEAD"` supplies the old version from git so nothing is copied. Next: record one real playsnack session as a "turns: N" case.
- Improve `observe` from field reports, because the real app is the source of truth.
- Add examples that show the say -> see -> judge loop, not only static JSON snippets.
- Start semantic recipes that fit the existing format, such as FAB press feedback and toast/snackbar presence. Record what the host must provide and what still needs new runtime support.

Done when: a real playsnack interaction is easier to tune with nudg than by editing component code, and the docs can point to that workflow honestly.

## Next: Layout-Aware Interactions

Status: format 0.4 (unreleased) measures positions and sizes: `tabs` and `accordion` no longer guess. Still ahead: arithmetic on measurements (offsets, fractions, `%`), bottom sheet snap points, a responsive swipe row.

Goal: support the component patterns whose motion depends on measured size or position.

- Add measured values such as tab indicator `x` / `width`, content height, sheet bounds, and action width.
- Support natural size / `auto`-like cases for accordion, collapsing rows, and sheets.
- Define `%` and relative units in a way that stays portable across web and native.
- Add conformance cases that separate runtime behavior from host measurement.
- Ship examples: tab indicator, accordion auto height, bottom sheet snap points, responsive swipe row.

Done when: `tab-bar`, `accordion`, `bottom-sheet`, and `swipe-row` no longer need hard-coded pixel guesses for their essential behavior.

## Then: Expand Semantic Pattern Recipes

Goal: turn common UI words into high-quality starting points for AI-built interfaces. Simple recipes start during dogfooding; measured patterns build on the layout work above.

- Expand the initial vocabulary in the [agent guide](../spec/guide.md#semantic-ui-words) with examples and contextual aliases for `fab`, `tab-bar`, `bottom-sheet`, `toast` / `snackbar`, `swipe-row`, `carousel`, `switch`, `slider`, `dialog`, `list`, `grid`, navigation bars, side nav, GNB and LNB.
- Expand presets or introduce a recipe layer that compiles patterns into ordinary nudg documents.
- Keep pattern metadata outside the runtime unless several patterns prove they need a shared lower-level feature.
- Define expected parts, states, events and motion for each recipe.
- Document host responsibilities for markup, responsive layout, focus and accessibility. Check touch, pointer, keyboard and reduced-motion behavior on mobile and desktop examples.
- Add examples and prompts that start from natural language: "make this a FAB", "add swipe actions", "show it as a bottom sheet".

Done when: an AI can reliably scaffold the same standard interaction from the same UI word, then only tune the motion values for taste.

## Later: Screens, Flows and Richer Motion

Goal: deliver the original stage 2 scope with patterns proven in app workflows.

- Build onboarding, modal flows, screen transitions and collection insertion/removal/reorder examples. Use them to establish requirements for data inputs and composing machines beyond today's nested states.
- Add decay / inertia for fling and scroll-like motion without snap points.
- Add small compositional primitives where real patterns need them: `delay`, `sequence`, `stagger`, or keyframes.
- Explore reusable behavior composition for patterns such as toast = presence + timer + dismiss + hover pause.
- Add continuous active-state motion for spinners or marquees if CSS state hooks are not enough.
- Keep every new primitive tied to at least one real pattern and one conformance case.

Done when: screen-level and collection-level interactions can be expressed without one-off host code for the motion logic.

Other existing candidates remain in [Design's open questions](design.md#open-questions), including cross-level transitions, a final-state marker, per-property reduced motion, discrete commit steps, nonlinear rubber banding, neighbor-limited snapping, multi-pointer gestures, motion overrides and schemes. They are retained design questions; a real pattern determines their priority. Decay may move forward if dogfooding needs it before screen composition.

## 1.0: Stable Web and React Core

Goal: make the TypeScript implementation and format stable enough for other people to build on.

- Freeze the 1.0 format surface: versioning, validation errors, conformance cases, and schema.
- Mark the stable API for `@nudg/core`, `@nudg/core/dom`, `@nudg/core/react`, and `@nudg/core/node`.
- Lock the judge workflow: `validate`, `simulate`, `compare`, `render`, `observe`, MCP, and the live demo.
- Document upgrade paths for older `.nudg.json` files.
- Decide whether semantic role metadata belongs in files, recipe metadata, or both.

Done when: a user can adopt nudg in a production web/React component and trust that the format will not churn under them.

## After 1.0: Native and Beyond

Goal: make the same interaction intent portable beyond web.

- SwiftUI and Jetpack Compose: first adapters are in; next, gestures, keys and distribution.
- A portable core, possibly Rust/WASM/FFI, if maintaining multiple runtimes becomes expensive.
- Native-specific host guidance for focus, accessibility, gesture systems, and reduced motion.
- Flutter or React Native if dogfooding points there.
- Standalone / canvas / game-like scenes only after the UI pattern story is strong; this is where a future relationship with bite can become concrete.

## Guardrails

- Update priorities and completion status here; other documents link here instead of maintaining their own queues. Keep technical questions in Design and release details in the changelog.
- Start from mobile-quality patterns, but keep the core platform-neutral.
- Use playsnack to find reusable requirements. nudg has no dependency on playsnack or bite; their relationship remains exploratory.
- Prefer recipes and examples before adding new format fields.
- Every new feature needs at least one real interaction, one conformance or regression test, and one way for the AI/person judge loop to inspect it.
- The person judges motion by seeing it. Graphs and numbers support the workflow; they are not the product.
