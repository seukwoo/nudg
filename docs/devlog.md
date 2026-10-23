# Development log

Problems met while building nudg, what caused them, and how they were resolved. Newest last. The point is to keep the reasoning behind the code: someone reading this later should understand not just what nudg does, but why it ended up that way.

Each entry: **Problem**, **Cause**, **Resolution**, and where useful **Lesson**.

---

## 2026-10-13: Format design (v0.1)

### One set of pointer rules, three languages
- **Problem:** The native adapters only pressed and tapped, so the drag examples (toggle, swipe row, sheet) were web-only, and each platform's gesture system would have drifted from the web's rules on its own.
- **Resolution:** the DOM adapter's rules became a small `PointerTracker` (press, 4-unit slop, `dragstart`, travel measured from the press, `up` or `cancel`, `dragend`, no tap after a drag), written once per language: TypeScript for React Native (on `PanResponder`), Swift for SwiftUI (on `DragGesture`), Kotlin for Compose (on `awaitEachGesture`). The Swift and Kotlin conformance runners got a pointer case: a 30-unit drag turns the drag toggle on, with no tap. On the Android emulator, both React Native and Compose turn the toggle on and off by dragging, and an 8 px (3 dp) nudge stays under the slop and taps.
- **Lesson:** Behavior that lives in an adapter needs its own conformance case, or each platform quietly invents its own version of it.

### Third runtime: Kotlin and Compose in an afternoon, again
- **Resolution:** the Kotlin runtime is a port of the Swift one onto the same compiled programs, with a 60-line JSON reader so it has no dependencies. It passed all 24 behavior cases on the first run; dropping the first-report snap failed 2, as in Swift. The Compose adapter reads values inside `graphicsLayer`, `layout` and `drawBehind` blocks, so frames never recompose. On the Android emulator the toggle springs on and recolors and a held button measures 319 px against 333 px at rest (0.96).
- **Two snags:** the current Compose BOM requires compiling against Android 37 (`checkDebugAarMetadata` failed on 36), and GitHub runners set `ANDROID_HOME`, so the Android modules are included only when `kotlin/local.properties` names an SDK; CI runs the pure-JVM conformance job.
- **Lesson:** With a conformance suite and a compiled format, each new platform is a port, not a design problem; the work moves to each platform's adapter idioms.

### Not web-only: React Native first, because the core already runs there
- **Problem:** The user asked why nudg was still web-only. The honest answer was order, not design: the core has no platform APIs and a language-neutral conformance suite, but every native host costs a port, an adapter and tooling. Xcode couldn't be installed yet (it needs a newer macOS), so iOS work waits.
- **Resolution:** React Native runs JavaScript, so the core runs unchanged. A platform-free `createPlayer` (the runtime plus its frame loop, with the clock and scheduler supplied by the host) carries the loop and presence logic out of the DOM adapter; `@nudg/core/native` writes values into `Animated` values. Checked on an Android emulator (Pixel 8 image, Expo Go): the toggle springs and recolors; a held button measures 323 px against 337 px at rest, the press preset's 0.96.
- **Two things on the way:** Expo Go couldn't reach Metro on the LAN address from the emulator; `adb reverse tcp:8081 tcp:8081` and `exp://127.0.0.1:8081` fixed it. And `avdmanager` from Homebrew ignores the SDK root; the command-line tools have to be installed inside the SDK.
- **Lesson:** "Any platform" was a claim until a phone ran a file. The cheapest proof was the host that runs the existing core, not a port.
### A second runtime, and the suite was the spec
- **Problem:** "Any platform" rested on one implementation. The user chose option A: native runtimes read programs compiled by the reference tools, so only one validator exists.
- **Resolution:** `nudg compile` writes a compiled program (format 1): everything resolved, every map an array of entries, since order matters and JSON readers differ. Before porting anything, the TypeScript conformance runner was made to run every case a second time through that JSON, so the format provably carries everything. The Swift runtime (about 450 lines) passed all 24 behavior cases on its first run; two deliberate breaks (a 1% damping error, a missing first-report snap) failed 14 and 2 cases, so the suite is sharp enough to be trusted as the spec.
- **No Xcode:** the command-line tools have no XCTest or Swift Testing, so the conformance runner is an executable that exits non-zero, which also suits CI. SwiftUI is in the macOS SDK, and `ImageRenderer` draws views without a window; the first render put the knob at 9.3 instead of 20 because `TimelineView` hands views the real date, not the model's injected clock. Views now read time from the model.
- **Lesson:** A language-neutral conformance suite turns a port from a risky rewrite into an afternoon: the cases say what to build and say when it is done.

### Which syntax: JSON, a JSON superset, or a DSL
- **Problem:** The format has to be easy for an AI to write correctly, easy to diff, and cheap to support on every platform.
- **Resolution:** Plain, strict JSON (`*.nudg.json`). Every platform already parses it, JSON Schema describes it, and LLMs write it reliably. JSON5 was the first recommendation (comments, trailing commas), but plain JSON won because it needs no extra parser anywhere. A DSL would read best, but an AI would have to learn it.
- **Lesson:** Comments are replaced by a `note` field on any object. A note survives tools rewriting the file, which a comment wouldn't.

### YAML's `off` problem
- **Problem:** The first example toggle had states named `off` and `on`.
- **Cause:** YAML 1.1 parsers (still common) read `off` and `on` as booleans, so `initial: off` becomes `false`.
- **Resolution:** YAML was ruled out. The toggle example itself demonstrated the risk.

### `on` as a key collides with a state named `on`
- **Problem:** Using `on` for transitions (as some statechart libraries do) produced `"on": { "on": ... }` in the toggle.
- **Resolution:** Transitions live under `when`.

### Where motion is declared
- **Problem:** Attach animations to transitions (timelines), or to properties?
- **Resolution:** "States say where, `animate` says how." States declare target values; each property has a motion that carries it to its target. Interruption is then correct by default: a new target mid-flight retargets from the current value, and a spring keeps its velocity. With timelines, every interruption would need its own rule.

### `motion` and `motions` differed by one letter
- **Problem:** The per-property map was called `motion` and the named-motion library `motions`. Both would be valid keys, so the validator couldn't catch a mix-up.
- **Resolution:** The per-property map was renamed `animate`.

### Unknown keys: ignore or reject
- **Problem:** The first plan was to ignore unknown keys (forward compatibility).
- **Cause:** Ignoring them means an AI's typo (`"duraton"`) silently does nothing.
- **Resolution:** An unknown key without a prefix is an error with a "did you mean" hint. Extensions use an `x-` prefix and are ignored.

### Many spring APIs, one spring
- **Problem:** iOS, Android and web libraries each describe springs differently, and the user wanted platform-specific motion to be expressible.
- **Resolution:** One physical spring with four accepted parameter forms (`duration` + `bounce` by default), all converting exactly to stiffness, damping and mass. Fit-to-duration springs are rejected because they aren't a single physical spring.
- **Follow-up:** `tension` / `friction` (seen in design tools) mean different things in different tools. They are rejected with a hint rather than guessed. The classic named curve families (`out-cubic`, `in-out-back`, ...) were added because designers and AIs already use those names.

### Platform-native feel versus identical motion
- **Problem:** Should one file move identically everywhere, or feel native on each platform?
- **Resolution:** Both. Identical by default; native feel through a motion scheme the host passes in explicitly, so results stay deterministic. Platform schemes are just motion libraries written in the same format, so a team's signature motion is a peer of Apple's or Material's. This led to three layers: core primitives, named motions with `import`, and schemes.
- **Follow-up:** Transient feedback (a heart that pops, a field that shakes) doesn't change any target, so it didn't fit "states say where". The `kick` primitive (add velocity, keep the target) and state `enter` were added for it.

## 2026-10-13: Reference implementation

### Proving the runtime right, not just consistent
- **Problem:** Expected values generated by the TypeScript runtime would only test it against itself.
- **Resolution:** `spec/conformance/derive.py` computes expected values independently. Springs are integrated numerically with RK4, while the runtime uses the closed form. A deliberate 0.05% change to the damping formula made 7 cases fail, which showed the suite is sensitive.

### "At rest" flickered
- **Problem:** The simulator reported a property at rest, then moving again.
- **Cause:** Rest was checked as |position| and |velocity| both below a threshold. An oscillating spring can pass that check at a turning point and leave it again.
- **Resolution:** Rest is judged on remaining amplitude from the spring's energy, sqrt(x² + v²·m/k). Damping means energy never increases, so the state can't flicker.

### One mistake, many errors
- **Problem:** An invalid base value (`"green"`) also produced "no base value" errors wherever the property was used.
- **Resolution:** A property with a valid path is registered even if its value is invalid, so only the real mistake is reported.

### The demo's state label lied
- **Problem:** Pressing the toggle and releasing outside it seemed to leave it stuck in `press/down`.
- **Cause:** The runtime was right (a release outside is a `cancel`, and the knob's scale returned to 1). The demo's label only listened for events inside the stage, and the release happened outside.
- **Resolution:** The label listens on the window.
- **Lesson:** This was found by driving real mouse events through the Chrome DevTools protocol, not by deterministic frames. Test the real input path too.

### Motion graph labels
- **Problem:** The like button's pop (max 1.209) wasn't marked; only its dip was. Peak markers also landed in the wrong place, and labels overlapped.
- **Cause:** The overshoot logic assumed a move from start to target, but a kick returns to its own start. The peak was searched in 240 Hz samples using a value from a 1 ms scan, which never matched exactly.
- **Resolution:** Every extreme outside the start-to-target range is marked, located on the drawn samples and labeled with the precise value. Spacing and edge anchoring were fixed by rendering the graph and looking at it.

### Chrome's profile couldn't be deleted
- **Problem:** `nudg render` crashed with `ENOTEMPTY` while cleaning up.
- **Cause:** Chrome was still writing to its temporary profile when it was deleted.
- **Resolution:** Wait for the Chrome process to exit before removing the profile, with retries, and treat a leftover temp folder as harmless.

### Serving TypeScript to the browser without a build
- **Problem:** `nudg render` runs the DOM adapter inside Chrome, and browsers can't run TypeScript.
- **Resolution:** The render server strips types on the fly with Node's `module.stripTypeScriptTypes`. Its one-time "experimental" warning is suppressed for CLI users. The built `dist` is served as-is when running from the npm package.

## 2026-10-13: Packaging and publishing

### Type declarations kept `.ts` import paths
- **Problem:** The built `.d.ts` files import `./core/compile.ts`, not `.js`.
- **Resolution:** No change needed, but this was verified instead of assumed: a fresh consumer project installed the packed tarball and type-checked against it.

### npm rejected the name `nudg`
- **Problem:** The first `npm publish` failed with 403: 2FA required. After that was set up, it failed again: "Package name too similar to existing packages nuxt, nedb, node, budo, pug".
- **Cause:** npm requires 2FA (now a security key or passkey) to publish, and its typo-squatting filter blocks names close to popular packages.
- **Resolution:** The package is `@nudg/core`, under a free `nudg` organization (the conventional `@org/core` pattern, leaving room for `@nudg/react`). The CLI command is still `nudg`. Scoped packages default to private, so `publishConfig.access` is `public`.

### The `bin` warning
- **Problem:** npm warned that the `bin` entry `./dist/cli.js` "was invalid and removed".
- **Cause:** npm 11 normalizes bin paths and complains about the `./` prefix. The warning had already appeared in an earlier dry run but was missed, because only the last lines of the output were read.
- **Resolution:** The path is now `dist/cli.js`. Installing 0.1.0 from the registry showed the command worked anyway (the registry normalized it), and 0.1.1 shipped the clean path.
- **Lesson:** Read the whole output of release commands, not the tail.

### Published, but not visible
- **Problem:** Publishing returned success, but the registry returned 404 for over ten minutes, and later listed an unknown `0.0.0-stage` version.
- **Cause:** Propagation delay for a new package. `0.0.0-stage` is a registry stub (`"stub": true`), not something we published.
- **Resolution:** Waited, then verified by installing from the registry with `npx -y @nudg/core`.

### CI couldn't be pushed
- **Problem:** Pushing `.github/workflows/ci.yml` was rejected: the OAuth token lacked the `workflow` scope.
- **Cause and detours:** `gh auth refresh` has no `-u` flag in the installed version; it always refreshes the active account, which was a different one. Then the GitHub web editor offered only "Fork this repository", because the browser was signed in to the other account too.
- **Resolution:** The user switched the browser to the right account and added the file through the web editor. Later they switched `gh` accounts, refreshed with the scope, and switched back. With the scope in place, the actions were upgraded from v4 (deprecated Node 20) to v7, and CI passed.
- **Lesson:** On a machine with several GitHub accounts, check which account the browser and `gh` are using before an auth step.

### A commit appeared from another session
- **Problem:** While features were being built on branches, a "docs: open source under MIT" commit appeared on `main`.
- **Cause:** Another session working in the same repository.
- **Resolution:** The feature branch fast-forwarded on top of it with no conflict. Notes that the license was still undecided were updated.

## 2026-10-13: Stage 1 design (v0.2)

### Expressions or structured operators
- **Problem:** Drag interactions need computation ("value at start plus drag distance", "color from position"). An expression language is compact, but the user pointed out that as expressions grow common, it gets hard to tell a formula string from ordinary text.
- **Resolution:** Design decision 9, "strings are never code". Strings are names or values; computation is always an object with one operator key (`follow`, `map`, `nearest`) from a small closed set.

### Who computes drag velocity
- **Problem:** Each platform measures pointer velocity differently, which would break determinism.
- **Resolution:** The runtime computes it from input samples: the least-squares slope over the last 0.1 s. The window is inclusive with a 1e-9 tolerance, and conformance cases place samples away from the window's edges so floating-point rounding can't make implementations disagree.

### Conformance cases that couldn't tell right from wrong
- **Problem:** Mutating the runtime (a 0.15 s velocity window, no momentum in `nearest`, no overdrag scaling of the handoff velocity) left every conformance case green.
- **Cause:** The first drag cases were too "clean": a constant-speed flick gives the same slope for any window, and releases far from the midpoint pass with or without momentum.
- **Resolution:** Cases were redesigned to fail under each mutation: a slow start then a flick released short of the midpoint (window and momentum matter), a release while moving below the range (overdrag scales velocity), and a release exactly at the midpoint (ties). Each mutation now fails at least one case.
- **Lesson:** Run mutation checks on every new behavior; a passing suite says nothing until it has been seen failing.

## 2026-10-13: Stage 1 implementation

### The new demo cards did nothing
- **Problem:** The draggable toggle and swipe row rendered but ignored every input, with empty state labels.
- **Cause:** The DOM adapter sampled the runtime at t = 0 after binding elements, but the real-time clock had already advanced by a fraction of a millisecond, so the runtime threw "time must not go backwards" and `play()` never returned. The 0.1 demo got away with it because binding was faster.
- **Resolution:** The initial sample uses the current clock time. Found by capturing the browser console over the DevTools protocol, which is now the first thing to check when a page "does nothing".

### A drag that stopped short of the finger
- **Problem:** Dragging the toggle 14 px back past the midpoint still left it on.
- **Cause:** Drag inputs measured travel from where the drag was recognized (after 4 px of slop), so the knob lagged the finger by the slop. The test drags were short enough for that offset to change the outcome.
- **Resolution:** Inputs measure travel since the press; `dragstart` counts as 0, so the first sample catches the value up with the pointer. The spec says so explicitly now.

### "Slow" drags aren't slow
- **Problem:** A test expected a 9-unit drag over 0.4 s to spring back, but it landed on.
- **Cause:** A steady drag still has velocity (22 units/s) at the moment of release; with momentum 0.5 s the projection crosses the midpoint. The runtime was right.
- **Resolution:** The test holds the pointer still before releasing. Position decides only when the finger has stopped, which is also how the conformance case was written.

## 2026-10-14: Demo

### Example code blocks collapsed to two lines
- **Problem:** Opening an example's source on the demo page showed an empty box with scrollbars (reported by the user with a screenshot).
- **Cause:** When the swipe row's CSS was added, a scripted find-and-replace targeted the first `textarea {` in the file, which was the tail of the shared rule `code, pre, textarea { font: ... }`. That turned the rule into `code, pre, .row { height: 56px; overflow: hidden; ... }`, so every code block inherited the row's height.
- **Resolution:** The rules were separated again. Found by measuring the `pre` and its ancestors over the DevTools protocol (height 56 px against 542 px of content), then grepping the stylesheet for `56px`.
- **Lesson:** Scripted replacements must anchor on a whole, unique line, not a fragment that can appear inside another selector list. Render the page after any stylesheet edit.

### Releases inside a shadow root looked like cancels
- **Problem:** On the new examples site, where each example's markup lives in a shadow root, a tap inside an example would have been reported as `cancel` instead of `up`.
- **Cause:** The DOM adapter decides between `up` and `cancel` in a window-level `pointerup` listener by checking whether `e.target` is inside the bound element. Events crossing a shadow boundary are retargeted to the shadow host, which the element doesn't contain.
- **Resolution:** The adapter uses `e.composedPath()[0]`, the real target, with `e.target` as the fallback.

### The playground only knew the toggle
- **Problem:** Pasting another example into the playground gave nothing to interact with, and files with imports couldn't compile there at all.
- **Cause:** The playground stage was hard-coded toggle markup, and it compiled text without a way to fetch imports.
- **Resolution:** "Open in playground" brings an example's markup along; any file whose targets the stage doesn't cover gets one labeled box per target, so every file is playable; `compileText` in the DOM adapter fetches imports relative to a base URL. Copy buttons were added on each card and in the playground.

### A stacked pull request closed itself
- **Problem:** The examples-site PR was stacked on the examples PR. Merging the first (rebase merge, branch deleted) left the second "dirty", and GitHub closed it when its base branch disappeared; a closed PR can't be retargeted.
- **Cause:** A rebase merge rewrites the commits, so the stacked branch still carried the old ones and conflicted with `main`.
- **Resolution:** Rebased the branch onto `main` (git skipped the already-applied commit), force-pushed, and opened a fresh PR.
- **Lesson:** With rebase merges and branch deletion, don't stack PRs; merge the base first, then branch from `main`. If stacking is unavoidable, rebase and retarget the dependent PR to `main` before merging its base.

### "Open in playground does nothing, Copy doesn't work, the select is empty"
- **Problem:** The user tried the demo and reported three dead controls at once.
- **Cause:** Three unrelated controls dying together means the page's script never started. The likeliest trigger is a stale `dist/dom/index.js` served from the browser cache (the Python static server sends no cache headers), so the import of a newly added export failed and nothing was wired up. The dead controls were just the visible symptom.
- **Resolution:** `npm run demo` now serves through `demo/serve.mjs`, a dependency-free static server that sends `Cache-Control: no-store`; the page shows a banner with the cause and the fix if its script hasn't started within a few seconds or a module fails to load (captured on the `<script>`, since module load errors don't reach `window.onerror`); copying falls back to a selection-based copy where the clipboard API is unavailable.
- **Lesson:** When several unrelated things break at once, look for the single upstream failure before treating each symptom. And a demo must tell the viewer when it is broken, not sit there quietly.
- **Follow-up:** The one-off DevTools scripts used to check the site became `test/demo.test.ts`: it builds, serves through `demo/serve.mjs`, and drives the site in headless Chrome (cards, filters, a drag inside a shadow root, reset, the playground, no page errors). Breaking the reset handler or the catalog URL makes it fail, so it guards the paths the user hit.

### Delete left the row gone for good
- **Problem:** After tapping Delete in the swipe row there was no way back short of reloading the page.
- **Resolution:** Each example has a Reset button (cards, the detail view, the playground) that destroys the player, restores the host markup, and starts again from the initial state, which is the per-component reset the user asked for.

## 2026-10-14: Platform motion

### Which numbers are the real ones
- **Problem:** Blog posts and community ports disagreed on Material 3 Expressive's spring values (380/0.73, 380/0.8, 700/0.6 all appeared), and Apple's docs pages are rendered client-side, so a plain fetch returns only the title.
- **Resolution:** Material values were read from the androidx source itself (`ExpressiveMotionTokens.kt`, `StandardMotionTokens.kt`); Apple's from the documentation JSON behind the rendered pages, which states the base bounce for `snappy` (0.15) and `bouncy` (0.3). The libraries cite their sources in `note`, and a test pins the numbers.
- **Lesson:** For published constants, go to the source file or the data behind the page; secondary sources drift.

### Native names or common names
- **Problem:** A platform library could expose the platform's own names (`snappy`, `spatial-default`), which are faithful but tie a file to one library, or shared names, which let one import line change the feel but hide the origin.
- **Resolution:** Both, in the same file: native names as published, and the common names `standard`, `quick`, `gentle`, `playful`, `fade` with a `note` saying which native value each one is. The agent guide says to default to common names and use native ones only when matching a platform exactly is the point.

## 2026-10-14: First use in an app (playsnack)

### The React hook's `files` keys had to be pre-normalized
- **Problem:** `useNudg(doc, { files: { "./snack.nudg.json": lib } })` reported the import as not found; only `{ "snack.nudg.json": lib }` worked.
- **Cause:** The compiler resolves imports to normalized paths before asking the file reader, and the hook passed the caller's keys straight through.
- **Resolution:** The hook strips a leading `./` from `files` keys, so they can be written the way imports are.
- **Lesson:** Found within the first hour of using nudg in a real app (the playsnack block button). Dogfooding finds what tests don't: the tests always wrote the normalized key.

### What the app needed that nudg didn't have
- A reduced-motion mode (the app honors `prefers-reduced-motion`; the component falls back to its CSS press for now).
- A mount/unmount pattern for toasts: a conditionally rendered element can't animate out. The app wraps the player in a component that unmounts after the exit; nudg could offer "settled" as React state to make that exact.

## 2026-10-14: v0.3

### A timer that had fired, in a state that said it hadn't
- **Problem:** With the toast's `after:3s`, a simulation sample at 3.5 s showed opacity 0 but state `shown`.
- **Cause:** Timers fire when the clock advances, which `sample(t)` does, but the sample row was built as `{ state: rt.state(), values: rt.sample(t) }`, so the state was read first. The conformance runner had the same order.
- **Resolution:** Sample first, then read the state, in the simulator, the runner and the DOM adapter's frame loop (which now re-syncs the state attribute and `onState` after every sample). `state()` itself takes no time and reports the machine as of the last advance.
- **Lesson:** Once time can change state on its own, every "read the state" must come after "advance the clock". Timers were the first feature where that order mattered.

### Commit carried the finger's speed
- **Problem:** A slider thumb released mid-drag settled at the right place, but wobbled first (50 → 40 → 50).
- **Cause:** Leaving a `follow` hands the input's velocity to the next motion, which is right for `nearest` (a flick should carry) but wrong for `commit` (the value is placed where it is).
- **Resolution:** `commit` drops the velocity; the spec says a committed value is placed, not thrown. A conformance case releases while moving and expects the value to stay exactly.

### The first review: "for this case, nudg had no advantage"
- **Problem:** A review of the playsnack block button (a 6 px press in a React shell) found nudg's version (two JSON files, a hook, a CSS selector) more work than Framer Motion's `whileTap` one-liner, with the same spring quality, and noted that `simulate`/`plot` validate the file, not the app.
- **Cause:** The first integration case was one where nudg's strengths (AI-editable definitions, many interactions sharing one motion library, hosts beyond the DOM) don't show, and its plumbing does. The review was right.
- **Resolution:** Presets make the simple case one line (`useNudg(presets.press())`), with `nudg preset` to turn one into a file when the options run out; the docs now say plainly what the tools check. Expansion in playsnack stops until a case needs what nudg is for.
- **Lesson:** Pick the first real-world case where the tool's distinctive value is visible, or the comparison will be made on the plumbing. And a library must be no worse than the one-liner alternative on the simplest case, whatever else it offers.

### The second review: the person is the judge, and the graph isn't for them
- **Problem:** The playsnack review (from a session using nudg through MCP) found the AI-native half already working: intent survives in `note` and named motions, "묵직하게" maps to two named-motion lines, validation runs without a person. What failed was the judging moment: in vibe coding the person doesn't read JSON; they say a word, look, and judge, and the graph served the AI, not them. The user confirmed: had before and after been on one screen, judging would have been easy.
- **Resolution:** `nudg compare` and `nudg_compare`: the tool speaks first (a perceptibility verdict with rough thresholds: a device pixel at 1×, about three frames), then shows real A/B filmstrips side by side from the host markup, or both curves on one graph. When nothing would be noticed it proposes an exaggerated version. The MCP instructions make the AI show it unasked after changing motion. The thesis and metric are now "turns per say → see → judge loop", not "better than Framer".
- **Lesson:** Build for the role the person actually has. Here that's judge, not author, so the output that matters is one they can rule on in two seconds.

### Overshoot measured against the wrong target
- **Problem:** A field report (the playsnack session re-running "더 묵직하게" with 0.3.1) found `compare` claiming "overshoot 0.3 → 6.0" for a press variant with bounce 0, whose simulation showed no overshoot at all.
- **Cause:** `compare` derived overshoot from the whole run's first and final values, so a round trip (0 → 6 → 0) had final ≈ first and the direction came from sign noise, making the peak itself count as overshoot. The original's 0.28 had been right by luck.
- **Resolution:** The simulator measures overshoot per target leg (the runtime now exposes `targets()`), in the direction of travel toward each target, and `compare` reads that. A test presses and cancels without bounce and expects 0.
- **Lesson:** A verdict sentence is only as trusted as its weakest clause; the headline was right, but a wrong supporting number sends the judge back to the graph. Derive every number in a judgment from the same model the verdict uses.

### "How would I tell from a photo?"
- **Problem:** The user, shown the marked A/B filmstrips, said stills can't show the difference between two motions. They were right: a filmstrip shows where things are at six moments, and a person judges feel, which is how things move between them.
- **Cause:** The judge tool was designed around what the AI can return in a chat (images), not around what a person needs to rule (the motion itself, slowed down).
- **Resolution:** `nudg compare --out compare.html` writes a page that plays both versions side by side on the real markup, same events, looping, with ¼× and ⅒× speed, pause, press-both with a chosen hold, and the live values under each stage. `nudg_compare` writes it next to the filmstrip and says "open this". The runtime is inlined from `dist/` as data: URLs in an import map (relative imports rewritten to a `nudg:/` scheme), so the page works offline, from any folder, with the exact runtime that judged it; a clone without a build falls back to unpkg at the package version. Two bugs on the way: a `"\n"` inside a template literal became a real newline in the page script, and rAF timestamps can trail `performance.now()` from the mount, which made the manual clock step backwards by a fraction of a millisecond.
- **Lesson:** The picture the tool can paste is not the picture the judge needs. When the subject is motion, the deliverable is something that moves, and the chat only carries the path to it.

### What the field report asked for next
- The report's priority list: host truth first (a transition the file plays but the page never shows, because the element unmounts on click), then perceptual framing of numbers, then exit handling in the adapter, then feel words in the guide. This change covers the numbers, the frames and the words; host truth is the next tool.

### A CI job that never ended
- **Problem:** On the release commit, the Node 26 job sat in `npm test` for 14 minutes; the same code had passed in 42 s a few minutes earlier, and Node 24 passed beside it.
- **Cause:** Not reproduced locally. The browser tests talk to Chrome over DevTools with no timeout on a call, so one lost answer (a crashed or frozen tab) waits forever; GitHub only gives up after six hours.
- **Resolution:** Every protocol call now fails after 30 s with the method's name, so a hang becomes a failed test with a message. The run was cancelled and rerun.
- **Lesson:** Anything that waits on another process needs a deadline, or a flake turns into a stuck pipeline.

### Why use nudg next to MUI at all
- **Problem:** The user asked the founding question: MUI and its peers already animate their components, so why add nudg? A component count (MUI lists 52, about 30 with interaction) also made the 20 examples look thin.
- **Answer we settled on:** when a library's defaults are enough, nudg isn't needed, and the docs now say so. nudg earns its place when the feel has to be tuned (MUI's motion is fixed-curve CSS transitions spread across theme and overrides; no springs, no interruption, no judge), when the interaction is outside the catalog (a thrown sheet, a swipe row), and across platforms. So nudg sits on top of libraries, not instead of them. Interactions are combinations, so coverage is measured by trigger × response × structure, not by component count.
- **Resolution:** two bridges cover most of the web's popular libraries without one adapter each: state attributes (`watch`: `data-state`, `aria-*`) for Radix, shadcn/ui, Headless UI, React Aria, Ark; and a react-transition-group style component (`nudgTransition`) for MUI's transition slot, Ant Design, React Bootstrap. The browser test bundles real MUI 9 and Radix with esbuild. MUI 9 had dropped the `TransitionComponent` prop the design assumed; it silently used its own Fade until the test caught it, and the docs now name `slots.transition`.
- **Lesson:** Integration claims need the real library in the test, not a stand-in that follows the documented contract from an older version.

### Critique: from "is it visible" to "is it good"
- **Problem:** The judge tools said whether a change was visible and whether the page played it, never whether the motion was good. Motion's MotionScore and Lottie's accessibility audit do say so; nudg's agent had no such reviewer.
- **Design:** `critique` plays every transition of every leaf state from rest on fresh runtimes, measures 90% time and settle time per property, and checks seven rules sourced from Material 3 motion, Apple HIG, WCAG 2.2.1/2.2.2 and the WAI-ARIA dialog pattern. Findings are warnings or suggestions with a pointer, a fix and a source, never errors.
- **Calibration:** the first run flagged almost every example as slow, because "settled" meant the runtime's rest threshold (1e-3 units): a 0.35 s spring took 0.74 s to get there. Settling was redefined as perceptual (staying within a pixel, or 0.5% of scale or opacity). Two rules were scoped after reading their sources: "exits faster than entrances" is about things leaving, not a press's springy release, and Escape is required of dialogs, sheets, menus and popovers, not of an accordion or a toast. After that the 20 curated examples produce one note, the 3 s toast, which the WCAG rule rightly questions.
- **Lesson:** A critic is only useful if it is quiet on good work. Calibrate it on examples you trust before trusting what it says about new ones.

### Layout as input: format 0.4
- **Problem:** Every example with an indicator or a panel hard-coded pixels (`segmented` assumed 72 px segments, `accordion` a 72 px panel), so a longer label or answer broke the motion. Motion's `layout` animations are the biggest capability gap between nudg and Motion.
- **Design:** the core never measures (decisions 3, 6, 9 stay intact). The host reports `target.layout.{x,y,width,height,naturalWidth,naturalHeight}` as inputs, and one operator, `measure`, reads them: positions align (`tab2.layout.x - underline.layout.x`), sizes are the size. The user agreed on "align" over raw coordinates because raw coordinates would need arithmetic, which would pressure decision 9.
- **Two rules found while writing the conformance cases:** the first report of a measurement must place values without motion, or every measured value would spring in from 0 on page load; later reports retarget with velocity, like a state change. And an unmeasured `set` falls back to the property's base, which a mutation check showed the first cases couldn't tell from 0, so the case now uses a base of 5.
- **Adapter:** offsets summed up the offset parents give an untransformed position, so nudg's own transforms never feed back into what it measures; scroll size is the natural size; a `ResizeObserver`, window resize, `document.fonts.ready` and late binds (React refs) trigger a re-measure. Checked in Chrome: renaming a tab grows it and the underline follows.
- **Lesson:** Make the platform-specific part an input, and the format stays testable with plain numbers.
### A log nobody can see is no evidence
- **Problem:** The user asked the obvious question about the local judge log: if it stays on each person's machine, how does the project ever learn anything?
- **Options weighed:** a one-click share of counts (no server, the person sees and submits it), opt-in anonymous telemetry (more data, but a server, a privacy policy and a consent prompt; silent telemetry in an npm package is a trust breach), or indirect signals (downloads, stars, issues), which say whether nudg is used but not how many rounds a change took.
- **Resolution:** `nudg log --share`: it prints exactly what would be sent, counts only, and opens a prefilled GitHub issue labeled `usage-log`. The skill may offer it once at the end of a round of work. Telemetry waits until there are enough users to justify its cost.
- **Lesson:** Privacy by default and evidence by consent are compatible if sharing is one click and shows its contents first.

### Evidence without waiting for a field test
- **Problem:** The metric chosen for nudg ("rounds per judged change") had no data, and the plan kept ending with "run it in playsnack and report back". The user called that a stall: nudg is open source, field validation will come from whoever uses it, and the roadmap should move on the agreed direction.
- **Resolution:** A local judge log. Every compare, observe and validate appends a JSON line to `~/.nudg/log.jsonl`; `nudg log` reports rounds per change (the same file compared again within 15 minutes; CLI runs are separate processes, so time, not session, defines a chain) and the share of rounds that showed nothing perceptible. Nothing is sent anywhere; users can attach the summary to an issue. A `nudg skill` installs a Claude Code skill so agents run the loop without being told. Research the same week (Motion AI Kit, Lottie Creator MCP, Rive MCP) found nobody else gives the person a judge: they edit and stop.
- **Lesson:** When a metric depends on other people's use, build the meter into the tool and ship it, instead of making one person's experiment the gate.

### One tool call from "heavier" to the before/after on screen
- **Problem:** With 0.5.1 the judge loop still took three turns in a real app: the AI had to know the host html file, copy the "before", and tell the person a path in /tmp. A design panel (three proposals, three judges) scored "compare from the running app" first because it is the only step that cuts turns directly.
- **Design:** `snapshotElement` opens the app in Chrome, finds the smallest element that contains every bound target (a toggle's track with its knob), clones it with computed styles inlined (minus what nudg animates: transform, opacity, transitions, animations), and reports what it can't carry: pseudo-elements, web fonts, targets missing from the page. The compare page is built from that snapshot as if it were a host file, and `open` launches the person's browser. For React, where targets are bound by ref, the adapter now writes `data-nudg` on bind so the snapshot can find them.
- **Lesson:** Fidelity is reported, not assumed: a snapshot that silently dropped a ::before would make the person judge the wrong thing. And "one turn" is a measurable target; the next cut is the "before" (a git revision), not more pixels.
- **The second review round (2026-10-16):** three lenses (real-page snapshots, git scenarios, the whole loop over MCP) found 21 defects, the first being the one the user saw with their own eyes: every `nudg_compare` call opened a new browser tab of the same page, and the test suite's html compare opened one on every `npm test`. Fixed by opening once per server session (the tab shows later comparisons after a reload), never from tests, and not at all when the versions are identical. The snapshot had three real holes: a body-wide snapshot emitted a `<body>` that the HTML parser merged into the compare page's own body (the whole page turned dark and flex), shadow roots were reported bound but not cloned, and a lone positioned target lost its containing block. Nested imports never played on the compare page because the files map was keyed by import spec rather than by path. Lesson: a review lens that walks the loop as the person experiences it (tabs, stale pages, wrong-side labels) finds what unit tests of each tool can't.
- **Follow-up, the same day:** `--before HEAD` / `before: "HEAD"`. The old version and its imports are materialized from `git show` into a temp folder with the same relative layout, so the render harness, the compare page and the compiler read it like any file. The AI no longer keeps a copy of the old file, which was the last manual step in the loop.

### The Node 26 job hangs after the tests pass
- **Problem:** Twice now the Node 26 CI job sat in `npm test` for over eight minutes while Node 24 passed beside it in a minute, once on a commit with no observe code at all. The 30 s per-call Chrome timeout added after the first time did not help, which means no call was hanging: the tests had finished and the process would not exit.
- **Cause:** Not pinned down on the runner, but the shape is an open handle after the browser tests (a DevTools WebSocket or a Chrome child that lingers) keeping the event loop alive, which Node 26 treats differently from Node 24. The test runner then waits forever, and GitHub only gives up after six hours.
- **Resolution:** `node --test --test-force-exit`: once every test has reported, the runner exits whatever handles remain. Hung runs are cancelled and rerun. A lingering poll in `launchBrowser`'s failure path (found by a verifier) was also fixed.
- **Lesson:** A test process that passes but never exits is a hang with a green log. Force the exit in CI and let the handle leak be a separate, visible problem.

### A review round on the judge tools: 26 demonstrated defects
- **Problem:** The week's judge tools (the compare page, `observe`, exits, the live A/B) shipped fast, each with a few tests. A four-lens review (core math, browser runtime, the site, the docs/API contract), with three independent attempts to refute every finding, found 26 real defects; all 26 survived refutation because each came with a reproduction.
- **The ones that mattered:** `observe` read every `matrix3d` transform as identity (the "3" in the function name matched the number regex), so any element with `translateZ` measured as never moving. Actions were sent to the first *animated* target, so the canonical toggle (knob moves, track is tapped) was judged "differs". A page still moving after the file came to rest was "played"; an element removed after its exit had settled, which is exactly what the new exits do, was "never shown"; a wrong target produced "played" with nothing measured. In the site, every remount restarted the players' clocks while the session kept the old ones, so a second tap collapsed onto the first and the verdict said "identical"; hook timers outlived their players and mirrored stale events into the other stage.
- **Resolution:** All fixed with a test each (new fixtures: a 3D press, a page that navigates, a page that throws). `actionTarget` reads which target an action is for from the file's own `when` keys and is shared by the CLI, the MCP tool and the compare page's "press both". `judgeHost` gained `unmeasured`, uses the observation's end when the page hasn't settled, and only calls an unmount "never shown" when it cut the motion short. The site keeps one session timeline across remounts, hooks get a player-clock `after()` that dies with the player, and a destroyed player ignores late sends.
- **Lesson:** A tool that judges needs its own judge. Every one of these was invisible to the happy-path tests and visible to a reviewer told to reproduce before reporting; the refutation step is what made the list trustworthy enough to fix blind.

### Host truth: measuring the page instead of trusting the file
- **Problem:** Every tool so far verified the file. The field report's top item was a release spring the file played perfectly while the app never showed it: the block unmounted on click. Nothing in nudg could see that.
- **Design:** `observe` drives the real page through Chrome DevTools (real pointer and key events, so React handlers, CSS transitions and navigation all run), and samples the element each frame: computed `transform` decomposed into translate, scale and rotation, plus `opacity`, size, and presence (re-querying the selector through open shadow roots, so an unmount or a remount is seen). The summary is in the file's terms (min, max, final, settled, overshoot), and the judgement reuses `compare`'s perceptibility thresholds. Overshoot on the page has no targets to measure against, so it is measured per leg between actions and plateaus; a leg that ends where it began reports none.
- **Two choices:** a `tap` holds for 80 ms and is marked as a down and an up, because a zero-length tap makes the file's press spring go nowhere and the comparison meaningless. And the file is simulated at the times the actions *actually* happened (the page's clock), not the requested ones, so a few milliseconds of scheduling jitter don't show up as a difference.
- **Lesson:** The host is the only ground truth. A file-level tool can be exact and still wrong about what a person sees; the judge needs one tool that looks at the page.

## 2026-10-15: Semantic UI patterns

### Natural-language UI needs standards, not fresh guesses
- **Problem:** When a person says "make this a FAB", "use tabs", "show it as a bottom sheet", or "add swipe actions", an AI can infer and code something from scratch each time. That works once, but the quality drifts: the shape may be right while state, gesture behavior, platform motion, accessibility or exit handling are missing.
- **Resolution:** The design direction is mobile-first semantic patterns. Common UI words should map to reusable interaction recipes with expected parts, states, events and motion: `fab`, `tab-bar`, `bottom-sheet`, `toast` / `snackbar`, `swipe-row`, `list`, `grid`, `carousel`, `switch`, `slider`, `dialog`, navigation bars and side navs. These start as presets, examples and AI guide rules, not new runtime magic; each recipe compiles to ordinary nudg targets, states and motions.
- **Lesson:** nudg's job is not only to tune animation properties. It should preserve the interaction intent behind human UI language, then let the person judge and refine the feel. The core stays small, while patterns give natural-language UI building a standard starting point instead of a one-off guess.

### Consolidating the development plan
- **Problem:** Adding a separate roadmap left overlapping stage tables in the README and design doc, while `CLAUDE.md` still listed the released presence and live A/B work as next steps. Replacing stage 2 with semantic patterns also hid the existing screens-and-flows scope.
- **Resolution:** [Roadmap](roadmap.md) now owns priorities, stage status and completion criteria. It preserves the original stages, connects semantic recipes to component and screen work, and distinguishes released work from unreleased fixes and open design work. README, Design, contributing guidance and working notes link to it; provisional 0.6-0.9 milestones become an ordered plan without release commitments.
- **Lesson:** Extend the existing plan before assigning new milestones. Keep scheduling in one place, technical choices in Design, and dated findings in the devlog.

## 2026-10-19: Recipes before breadth

### Existing examples become contracts, and gaps choose motion work
- **Problem:** The growing example set demonstrated useful UI, but an agent still had to infer what a word such as "sheet" or "video chat" meant each time. Continuing to add components would widen the gallery without making generation more consistent, while adding motion primitives speculatively would make three runtimes harder to keep aligned.
- **Resolution:** Every shipped example now belongs to a versioned external recipe. The CLI and MCP resolve human aliases to expected parts, states, events, inputs, host responsibilities, motion, known gaps and a validated starter. The runtime grammar remains component-neutral. The roadmap freezes broad catalog growth for now and ranks lower-level work from repeated recipe gaps: layout arithmetic first, then pausable timers; keyframes, sequence, decay, continuous loops and derived scroll inputs follow only when evidence and cross-runtime semantics are strong enough.
- **Lesson:** A recipe is the stable bridge from natural language to ordinary nudg, not a new component primitive. Examples prove the contract; repeated inability to express their motion earns new syntax.

### Layout arithmetic exposes the next smaller gap
- **Problem:** Bottom-sheet and swipe-row resting states copied dimensions from their hosts, so changing a sheet height or action width broke the snap target. A general expression language would solve that and much more than the recipes asked for.
- **Resolution:** Format 0.6 adds only `times` and `plus` to `measure`: multiply the measured size or aligned position, then add a logical-unit offset. TypeScript, Swift and Kotlin share one conformance case. The examples now derive resting states from layout, while their numeric `follow.range` and `map.from` values remain explicit.
- **Lesson:** Solving measured targets revealed a narrower remaining need: measured range endpoints, not arbitrary expressions. Keep that gap in recipe metadata and let it compete with pausable timers instead of silently expanding 0.6.

### Pausable timers own remaining time
- **Problem:** Toast dismissal and video-control auto-hide were timers, but hover, keyboard focus, scrubbing and app suspension either needed duplicated states or host-side `setTimeout` code. Overlapping reasons made a single paused flag ambiguous.
- **Resolution:** Format 0.7 puts `pause` event pairs on an `after:` transition. Reasons block independently; the first `on` freezes remaining time and the final `off` resumes it. Re-entry resets the timer, and the existing rule that due timers fire before same-time events remains intact. The video example now removes its host timeout entirely.
- **Lesson:** Timer ownership belongs with the state that owns the timeout, while the host only reports semantic lifecycle events. This keeps recipe behavior portable without making nudg own browser or device APIs.

### Keyframes stay transient and state-owned
- **Problem:** A spring kick can make a field wobble, but it cannot author the exact left-right rhythm designers expect from validation feedback. A general sequence system would also introduce delays, cancellation and composition rules that no current recipe yet requires.
- **Resolution:** Format 0.8 adds inline keyframes only to `enter`. The current value and state target are implicit endpoints, intermediate points carry normalized times, re-entry starts from the sampled position, and interruption exposes the current velocity to the next ordinary motion. Reduced motion skips the whole transient effect. TypeScript, Swift and Kotlin execute the same compiled frames.
- **Lesson:** Keyframes solve authored multi-beat feedback without becoming a second state machine. Keeping the final value owned by the state preserves nudg's central rule: states still say where.

### Example media must survive a subpath deployment
- **Problem:** Music and video assets used root-absolute `/examples/media/...` URLs. They worked on the local root server, but a project-site deployment resolved them outside the repository path, leaving the music player with a broken cover and an `Unavailable` state.
- **Resolution:** Media examples now use `../examples/media/...`, which resolves to the same asset from both standalone example pages and the embedded demo, including a repository subpath. The browser test checks the authored URLs and verifies that the album cover decodes at its real width.
- **Lesson:** Example hosts are consumed in more than one document context. Asset URLs must be portable across both contexts, and browser tests should assert visible media rather than only the surrounding controls.

### A video call cannot disappear behind device permission
- **Problem:** The video-call example showed only `Join video` until camera permission succeeded. If both camera attempts failed, it silently returned to that same screen, so none of the advertised camera, microphone, flip or leave behavior could be explored. Muting and then flipping the camera also made the microphone button claim it was unmuted while the replacement track remained disabled.
- **Resolution:** A call now joins with unavailable devices turned off, exposes the complete control surface, and lets the camera button retry permission in place. Media capability and enabled state are separate; switching cameras preserves mute, leaving resets both for the next call, and status text names missing devices. Browser tests cover denial, retry, video-only fallback, mute across camera switching and cleanup.
- **Lesson:** Permission is a host capability, not the interaction's gatekeeper. A portable call recipe needs explicit degraded states and recovery, especially in a public example where the visitor may deny every device.

### Critique must enter parallel state configurations
- **Problem:** `nudg critique` reported zero transitions for the video call because its transition walker skipped every machine whose root used parallel regions. The example looked clean only because it had never been played by the critic.
- **Resolution:** The critic now builds complete state configurations across regions, measures each regional transition once with the other regions present, and retains exact JSON pointers. A test proves two independent regions are both exercised. This also exposed and fixed an imperceptible music-player error-state change.
- **Lesson:** A clean report is meaningful only when coverage is nonzero. Structural features supported by the runtime must either be exercised by judge tools or called out as unmeasured.

## 2026-10-21: Measured endpoints close the layout loop

### Resting points, drag bounds and derived feedback share one measurement
- **Problem:** Format 0.6 let bottom-sheet and swipe-row resting states derive from layout, but their drag bounds and opacity map points still copied the same height or width as numbers. A responsive resting point could therefore disagree with the gesture that reached it.
- **Resolution:** Format 0.9 accepts the existing measure object in `follow.range` and `map.from`. Before layout arrives a follow is unconstrained and a map holds its base; the first complete report activates both, and relayout updates them without restarting the gesture. TypeScript, Swift and Kotlin share the same conformance case, while compiled program format 2 carries measured endpoints and current runtimes still read format 1.
- **Lesson:** Reuse the smallest existing operator where the semantics already match. Endpoint measurement closes a demonstrated recipe gap without adding expressions or teaching the core about sheets and swipe actions.

## 2026-10-22: Gap counts pick loops

### The expected primitive was not the most needed one
- **Problem:** The roadmap expected `sequence` / `stagger` to be the most repeated gap. Registering menus, spinners, screen transitions and the rest as gap-only recipes, and counting them with `nudg recipe --gaps`, put screen composition and continuous motion first (4 each), sequence and stagger at 3.
- **Resolution:** Continuous motion was promoted because it stays inside one player while screen composition is stage 2 work across players. Format 0.10 loops gave spinner, skeleton and typing indicator starters and removed pull-to-refresh's CSS workaround; a per-loop `delay` also covered the typing dots' stagger without a general stagger primitive.
- **Lesson:** Count before choosing. A fixed capability vocabulary turned "what's missing" from an impression into a number, and the number disagreed with the impression.

### Rounding a wrapped offset differently in three languages
- **Problem:** Leaving a loop with `wrap` reduces the offset to its nearest equivalent of 0. "Nearest" written as `round(offset / wrap)` rounds halves differently in JavaScript (`Math.round(-0.5)` is -0), Python (to even), Swift (away from zero) and Kotlin's `Math.round` (up), so a spinner stopped at exactly half a turn would have unwound in different directions per runtime.
- **Resolution:** The spec states the range, `(-wrap/2, wrap/2]`, and the formula `offset - wrap * ceil(offset / wrap - 0.5)`, which every language computes the same way. All runtimes use it.
- **Lesson:** "Nearest" is not a portable definition. Anything a conformance suite compares must be specified as arithmetic, down to ties.

### The biggest gap was a labeling mistake
- **Problem:** Stack navigation, full-screen modal, shared element and drawer were registered as gap-only under "screen composition", which tied for the most counted gap and was planned as stage 2 work: composing players across screens.
- **Cause:** The gaps were assigned from what the patterns sounded like, not from trying to write them.
- **Resolution:** Written as files, each was one player whose targets are roles (`screen` / `previous`, `modal` / `presenting`, a card between two measured boxes), with mounting left to the host through `onExit`. The only thing missing was a measured value in a map's `to`, for parallax and push distances; format 0.11 adds it with the 0.9 endpoint rules. Four recipes got starters and the gap disappeared.
- **Lesson:** A gap is a claim to test before it is a plan. Writing the file is cheaper than designing a primitive, and it found the smaller one.

### Sequence became a delay
- **Problem:** Accordion, menu and speed dial needed order: content after the panel, items one after another, actions out and back in reverse. The roadmap expected a `sequence` / `stagger` combinator, a list of steps beside the states.
- **Resolution:** A timeline answers it with less: a start delay per property's motion. A transition's `animate` already overrides motion per property, so a stagger is growing delays there and the reverse order is the closing transition's own. Interruption kept the existing rule plus one line: a pending motion that hasn't started is dropped. Format 0.12; the three recipes got starters.
- **Lesson:** Look for the smallest timing knob that the existing structure can carry before adding structure. Steps that wait on each other's completion may still need a combinator; nothing in the catalog does yet.

## 2026-10-23: The list was one player per row

### Sending from onSettle ran the clock backwards
- **Problem:** The animated list commits its new order from `onSettle`, sending `host.commit` to every row. In Chrome the frame loop then threw "Time must not go backwards", which also broke a later demo test.
- **Cause:** `lifecycle.frame` took its time before calling `onSettle`, then asked `settled()` at that time. The events the host sent from inside the callback had already advanced the runtime to the page's current clock, a fraction of a millisecond later. `changed()` already re-read the runtime's time after `onState`; `frame()` didn't after `onSettle`. Swift swallowed the error with `try?` and reported a wrong settle.
- **Resolution:** All three lifecycles take the later of the frame time and the runtime's time after `onSettle`. A player test sends from inside `onSettle` with a clock that moves on, and fails without the fix.
- **Lesson:** Every callback a host can react to is a place where the host may send. A host that coordinates several players (lists, screens) reacts from callbacks as a matter of course, so each one must leave the runtime in a state the caller can continue from.

### Every recipe has a starter
- **Problem:** The catalog's last gap, the image viewer, needed two pointers: a pinch's scale, turn and centre. Following a ratio by adding its change also zoomed wrongly from anything but 1x.
- **Resolution:** Format 0.18 adds pinch events and inputs from the shared pointer tracker, checked against the same two-pointer sequence in TypeScript, Swift and Kotlin, and `"multiply": true` on `follow`. The DOM, React Native and Compose adapters track pointers; SwiftUI reports its own magnify and rotate gestures, without the midpoint. A Chrome test pinches the viewer with two emulated touches. Its first version left the emulated pointer over the stage, so the next test's playground counted a stray interaction; the test now moves the pointer away when it ends.
- **Lesson:** Of the eight gap capabilities registered on 2026-10-22, three turned out to be smaller than their names (screen composition, collection coordination: one player per item with the host coordinating; sequence: a delay), and every one closed with a single format addition shared by three runtimes. Writing the file first is what found the small version each time.
