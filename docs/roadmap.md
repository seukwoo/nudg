# Roadmap

nudg is early. The format can still change before 1.0, but the development direction is clear: make natural-language UI building produce standard, mobile-quality interactions instead of one-off motion guesses.

This is the single development plan for priorities, stage status and completion criteria. It consolidates the stages previously listed in the README and design doc, and the next steps previously kept in `CLAUDE.md`. Design rationale and unresolved technical choices stay in [Design](design.md#open-questions); implemented behavior is defined by [the spec](spec.md), and release history stays in the [changelog](../CHANGELOG.md). The [devlog](devlog.md) records findings at the time, not the current queue.

The order below follows real app needs. Release numbers and dates are assigned when scope is established; the earlier 0.6-0.9 headings were provisional. Package and format versions are separate: package 0.8.0 ships format 0.5.

## Current Baseline

| Work | Status | Evidence |
|---|---|---|
| States, motion, gestures, timers, keyboard events, reduced motion; DOM and React adapters | Implemented through format 0.3 | [Spec](spec.md), [usage](usage.md) |
| Press, hover, toggle and toast presets; platform motion libraries | Implemented | [Agent guide](../spec/guide.md#presets), [usage](usage.md#native-feel-on-every-platform) |
| `compare` and `observe` | Released | [Changelog](../CHANGELOG.md) |
| Exit/presence handling and live A/B in the playground | Released in package 0.5.0; the old next-step note is complete | [Changelog](../CHANGELOG.md#050) |
| Semantic UI recipes | Versioned contracts cover every shipped example; CLI and MCP resolve names and aliases to contracts and starters | [Recipe catalog](../recipes/index.json), [agent guide](../spec/guide.md#semantic-ui-words) |
| Layout measurement and natural size | Implemented in format 0.4 | [Spec](spec.md#layout-inputs) |
| Layout arithmetic and relative measured values | Implemented for the next release in format 0.6 | [Spec](spec.md#additions-in-06) |
| Pausable timers | Implemented for the next release in format 0.7; TypeScript, Swift and Kotlin share conformance | [Spec](spec.md#additions-in-07-draft) |
| Decay | Open design work | [Open questions](design.md#open-questions) |

## Product Stages

The original stage numbers remain useful when reading the spec and changelog. Semantic patterns apply across component and screen work; they extend those stages.

| Stage | Scope | Examples and needs | Status |
|---|---|---|---|
| 0 | Single element | Toggle, button, like; states, transitions, springs, DOM adapter | Implemented |
| 1 | Component | Tabs, accordion, swipe row, carousel, bottom sheet; coordinated targets, gestures, React adapter | Measurement and arithmetic implemented; measured follow/map bounds remain open |
| 2 | Screens and flows | Onboarding, modals, screen transitions, list/grid coordination; data inputs and machine composition | Planned; nested states and a dialog example already exist |
| 3 | Native | iOS and Android; React Native, SwiftUI and Compose adapters plus matching runtimes | Initial platform support implemented; 0.8.0 is the first distribution tag |
| 4 | Standalone content | Physics, canvas, game-like scenes; host rendering and physics integration | Exploratory |

## Now: Deepen Motion From Recipe Evidence

Status: the first versioned recipe catalog covers every shipped example. Broad catalog growth and Playsnack workflow validation are deferred while the repeated lower-level gaps are implemented.

- Done: format 0.6 layout arithmetic across TypeScript, Swift and Kotlin, with responsive bottom-sheet and swipe-row resting states.
- Done: format 0.7 pausable timers for toast dismissal and video-control auto-hide.
- Done: format 0.8 entry keyframes with interruption, relayout and reduced-motion rules shared across all three runtimes; validation feedback now uses them.
- Next: let measured `follow.range` and `map.from` endpoints remove the remaining duplicated layout constants.
- Keep examples as executable evidence for recipes, not as a component-count target; do not widen the catalog during this work.
- Follow with derived scroll direction/velocity and decay only when the earlier primitives are complete.

Done when: the current recipes no longer duplicate essential measured resting points or rely on undocumented timer and multi-beat motion workarounds.

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

Status: format 0.4 measures positions and sizes; format 0.6 adds arithmetic for offsets and fractions. Still ahead: measured bounds for `follow` and measured points for `map`.

Goal: support the component patterns whose motion depends on measured size or position.

- Done: measured tab indicator position and width, accordion natural height, bottom-sheet snap states, and swipe-row resting width.
- Done: portable fractions and offsets through format 0.6 `times` and `plus`, with cross-runtime conformance.
- Next within this area: let `follow.range` and `map.from` reuse measured values instead of duplicating their numeric endpoints.

Done when: `tab-bar`, `accordion`, `bottom-sheet`, and `swipe-row` no longer need hard-coded pixel guesses for their essential behavior.

## Queue Details

Goal: deepen the interaction and motion language where current recipes demonstrably run out of vocabulary.

| Candidate | Evidence in current recipes | Decision gate |
|---|---|---|
| Layout arithmetic and relative snap points | Bottom sheet and swipe row resting states depended on constants | Implemented for format 0.6; measured follow/map endpoints remain separate work |
| Pausable timers | Toast dismissal and video control auto-hide pause for focus, hover, scrubbing or app suspension | Implemented for format 0.7 with deterministic remaining-time semantics |
| Keyframes | Reaction bursts and authored validation shakes need more than one kick | Implemented for format 0.8 as transient entry effects with deterministic interruption and reduced motion |
| Sequence | Accordion requests already ask for the chevron and panel to move in order | Wait for a second independent recipe before adding syntax |
| Decay | Free-scrolling carousel variants need inertial travel before snapping | Define velocity, bounds and interruption across platforms |
| Continuous active motion | Pull-to-refresh still uses a CSS spinner workaround | Decide whether indefinite loops belong in nudg or remain a host visual |
| Scroll direction and velocity | App bars can map position but cannot hide on down and reveal on up | Generalize as derived continuous inputs, not a header-only feature |

For each promoted primitive: start with the recipe contract and conformance case, implement TypeScript, Swift and Kotlin parity, then update the starter and judge tooling. `stagger`, collection coordination and screen transitions wait until recipes for lists, grids or flows supply concrete evidence.

Done when: the highest-value current recipes no longer need duplicated layout constants or undocumented host animation, without turning nudg into a component library.

## Later: Screens, Flows and Richer Motion

Goal: deliver the original stage 2 scope with patterns proven in app workflows.

- Build onboarding, modal flows, screen transitions and collection insertion/removal/reorder examples. Use them to establish requirements for data inputs and composing machines beyond today's nested states.
- Add decay / inertia for fling and scroll-like motion without snap points.
- Add small compositional primitives where real patterns need them: `delay`, `sequence`, or `stagger`.
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
- Revisit semantic role metadata in files only if external recipe metadata proves insufficient; external metadata is the current decision.

Done when: a user can adopt nudg in a production web/React component and trust that the format will not churn under them.

## After 1.0: Native and Beyond

Goal: make the same interaction intent portable beyond web.

- SwiftUI and Jetpack Compose: adapters, matching runtimes and tagged distribution are in; next, harden native host guidance and accessibility behavior.
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
