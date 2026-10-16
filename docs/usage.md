# Using nudg

The CLI, the MCP server, the React and DOM adapters, and the platform motion libraries. Install with `npm install @nudg/core` (Node 22.4 or later), or work from a clone, where Node 23.6 or later runs the TypeScript sources directly.

## CLI

`nudg validate`, `simulate`, `plot`, `render`, `compare`, `observe` and `preset` are the same tools an agent gets over MCP. Every command takes `--json` for machine-readable output, and `nudg --help` lists all options. From a clone, run `node src/cli.ts` in place of `npx nudg`.

### validate

Errors carry a stable code, a JSON pointer, and a hint, so an AI can fix its own output. Here a spring has a typo:

```
$ npx nudg validate bad.nudg.json
bad.nudg.json: 2 errors
  error unknown-key at /animate/knob.x/spring/duraton
    Unknown key "duraton".
    hint: Did you mean "duration"?
  error spring-incomplete at /animate/knob.x/spring
    The spring is missing duration.
    hint: Add "duration", or use the default form: "duration" + "bounce".
```

### simulate

Sends events at given times and reports states and values, with no rendering. Tap the toggle at 0.1 s and watch the knob spring across, overshoot slightly, and settle:

```
$ npx nudg simulate examples/toggle.nudg.json --send track.tap@0.1 --every 0.1
t      state  knob.x  track.color
0.000  off    0.000   #d1d5db
0.100  on     0.000   #d1d5db
0.200  on     12.582  #82dc9f
0.300  on     19.910  #4ade80
0.400  on     20.485  #4ade80
...

summary
  knob.x       final 20.000  min 0.000  max 20.567  at rest from 0.835s
  track.color  final #4ade80  at rest from 0.301s
```

Drags are scripted too. `--drag track:14@0.1-0.25` drags on the track 14 units to the right between 0.1 s and 0.25 s, sending `down`, `dragstart`, input samples at 60 per second, `up` and `dragend`:

```sh
npx nudg simulate examples/toggle-drag.nudg.json --drag track:14@0.1-0.25
```

### plot and render

```sh
npx nudg plot examples/like.nudg.json --send heart.tap@0.1 --out like.png
npx nudg render examples/like.nudg.json --html examples/like.html --send heart.tap@0 --out frames.png
```

See [Seeing motion](#seeing-motion) below.
All three also take `--reduced-motion` (0.3): springs and tweens become 0.15 s linear tweens and kicks do nothing, so you can check what a reduced-motion user sees.

### compare

```sh
nudg compare toggle.nudg.json toggle-bouncier.nudg.json --send track.tap@0.05 --html toggle.html --out compare.png
```

Two versions under the same events, for a person to judge. It speaks first:

```
A clear change: knob.x moves up to 2.1 units differently, settles 0.23 s later, overshoot 0.6 → 1.9 units.

  knob.x: differs by up to 2.11 units at 0.21s (subtle); overshoot 0.57 → 1.90 units; at rest 0.79s → 1.01s (clear).
  track.color: identical.
```

With `--html`, the frames aren't only evenly spaced: the moments the verdict talks about are always included and captioned (where each property differs most, each event and 80 ms after it), so the side-by-side shows what the sentence says.

**Against the last commit.** The "before" is usually what git already has:

```sh
nudg compare block-press.nudg.json --before HEAD --send button.tap@0.1 --url http://localhost:5173/ --open
```

`--before <rev>` (HEAD, HEAD~1, a branch, a tag) reads the file and its imports as they were at that revision, so there is no copy to make or clean up; the labels become the revision and "now". Over MCP: `file` with `before`, or `{ file, rev }` on either side.

**From the running app.** When the component lives in an app, there is no host page to point at. Give `compare` the app instead:

```sh
nudg compare block-press.nudg.json block-press-heavier.nudg.json --send button.tap@0.1 --url http://localhost:5173/ --open
```

It snapshots the component from the page (the smallest element holding every bound target, styles inlined; `--select` picks another), writes the side-by-side page from that snapshot, and `--open` opens it. The report says what the snapshot couldn't carry (pseudo-elements, web fonts) and which targets weren't on the page. Over MCP the same is `url`, `selector` and `open`, so one tool call ends with the before/after playing in the person's browser. The page opens once per session; later comparisons rewrite the same page and the open tab shows them after a reload (`open: true` forces a new tab, `open: false` or `NUDG_OPEN=false` never opens). Two versions that behave identically open nothing.

Stills can't show motion. For the person, write a page instead:

```sh
nudg compare toggle.nudg.json toggle-bouncier.nudg.json --send track.tap@0.05 --html toggle.html --out compare.html
```

`compare.html` plays A and B side by side on the real markup, with the same events, in a loop, with the live values under each. Buttons: replay the events, **press both** (a tap on both at once on the first target the file lets you press, with a 0.3 s or 1 s hold), speed 1× / ¼× / ⅒×, pause. The stages also respond to your own taps and drags. The runtime is inlined from the package's build, so the file works offline and from any folder; from a clone, run `npm run build` first, or the page loads the runtime from unpkg.

Each property gets a verdict: **imperceptible** (under a device pixel at 1×, or under about three frames), **subtle**, or **clear**. When nothing crosses the threshold it says so and proposes the next turn: look at an exaggerated version first, then dial it back. With `--html` the picture is real A/B filmstrips in two rows, same markup, same moments; without it, both curves on one graph (solid A, dashed B). `--labels now,bouncier` names the rows.

### critique

```sh
nudg critique toast.nudg.json
```

Valid isn't the same as good. `critique` plays every transition from rest and checks it against the platforms' motion guidelines and accessibility rules:

```
toast.nudg.json: 0 warnings, 1 suggestions (5 transitions checked).

suggestion short-timeout at /states/shown/when/after:3s: shown goes away after 3 s, and nothing pauses it.
  fix: Give people time to read it: Material snackbars stay 4–10 s. Pause it while hovered or focused, or let it be dismissed instead.
  from: WCAG 2.2.2 Pause, Stop, Hide / 2.2.1 Timing Adjustable
```

| Code | When |
|---|---|
| `slow-transition` | A transition takes 0.6 s or more to settle, as far as a person can see (a warning from 1 s). |
| `late-feedback` | A press (`down`) gets less than 90% of its feedback within 0.15 s. |
| `invisible-change` | Everything a transition moves stays under a pixel or 2%. |
| `bouncy-fade` | Opacity or a color springs with overshoot, which is clipped and only delays settling. |
| `slow-exit` | Going back to the initial state takes clearly longer than leaving it (not a press's release). |
| `short-timeout` | Something shown goes away by itself in under 4 s. |
| `no-escape` | A dialog, sheet, menu or popover can be closed, but not with Escape. |

Findings are warnings or suggestions, never errors; `--strict` exits 1 on warnings, for CI. Over MCP it is `nudg_critique`, and the server tells the agent to run it after every change.

### observe

The file says what should happen. `observe` says what the real page showed:

```sh
nudg observe http://localhost:5173/ --file block-press.nudg.json --do tap@0.1
nudg observe examples/button-press.html --select '[data-nudg="button"]' --do down@0.1 --do up@0.5
```

It opens the page in headless Chrome with its scripts running (a local `.html` is served from the working directory), performs the actions as a finger or a key would (`down`, `up`, `tap`, `hover`, `leave`, `key:escape`, ...), measures the element every frame (translate, scale, rotation, opacity, size, and whether it is still in the page), and reports:

```
The element left the page at 0.18s, mid-motion: what the file plays after that is never shown.

#btn on unmount.html, after down at 0.10s, up at 0.18s:
  scale: 0.974 … 1.000; final 0.974; still moving at the end
  the element left the page at 0.18s
```

With `--file` it judges the page against the file under the same actions, at the times they actually happened: **played** as the file says, **differs** (a CSS transition on the same property, a re-render that resets the element, a stale build), **never shown** (the element unmounted mid-motion; one that leaves after the motion settled is fine), **nothing moved** (the element isn't bound, or the actions don't reach it), or **unmeasured** (nothing of the target could be measured; colors can't be yet). The actions become the file's events on the first target that handles them (a toggle's track, not its knob); `--on <target>` overrides that, `--send` overrides the events. `--select` defaults to `[data-nudg="<the file's first animated target>"]`; `--settle` and `--warmup` set how long to measure after the last action and how long to let the page start; `--viewport 390x844` sets the window. Exit codes: 0 the page played the file, 1 it didn't, 2 it couldn't be observed (no element, no Chrome, bad options). If the page threw, the report says so first.

### preset

```sh
nudg preset press > press.nudg.json
nudg preset toast --options '{"duration": 5}'
```

Prints a preset (`press`, `hover`, `toggle`, `toast`) as a nudg file. The same presets are `presets.*` in `@nudg/core` and `@nudg/core/react`, for use without a file: `useNudg(presets.press())`, `playDoc(presets.hover(), element)`.

### Layout without a page

`simulate`, `plot` and `compare` take what the page would measure, for files that use `measure` (0.4):

```sh
nudg simulate tabs.nudg.json --send tab2.tap@0.1 --layout underline.x=8,tab1.x=8,tab1.width=74,tab2.x=86,tab2.width=88
```

Each `target.measurement=value` is reported at time 0. Without it, measured values fall back to their base, and the output lists what's missing. `render`, `observe` and `compare --url` measure the real page instead. Over MCP the same is `layout: { "tab2.x": 86, ... }`.
### log

```sh
nudg log            # what the judge loop looked like on this machine
nudg log --json     # the same, for an issue or a script
```

Every `compare`, `observe` and `validate`, from the CLI or the MCP server, appends one line to `~/.nudg/log.jsonl`: the tool, the files, the verdict, whether a page opened. `nudg log` summarizes it, above all **rounds per change**: how many times the same file was compared again within 15 minutes before the work moved on. One round means the person judged the change at the first look. It also counts rounds that showed nothing anyone could see. The log never leaves the machine on its own; `NUDG_LOG=off` turns it off, `NUDG_LOG=<file>` moves it, `nudg log --clear` empties it.

To help the project, `nudg log --share` prints exactly what it would share (counts only: rounds per change, verdicts, tool calls, nudg and Node versions; no file names, paths, URLs or code) and opens a prefilled GitHub issue for you to read and submit. That is how nudg learns whether the loop takes one round or five. When a change reaches three rounds, nudg asks right then (the CLI prints the command; over MCP the agent asks and `nudg_share` gives the person the link with their note): those are the changes the project most needs to hear about. `--note "..."` adds a line in your words.

### skill

```sh
nudg skill          # ./.claude/skills/nudg/SKILL.md, for this project
nudg skill --user   # ~/.claude/skills/nudg/SKILL.md, for every project
```

Installs a Claude Code skill that teaches the agent the loop: validate, compare against `HEAD` on the running app, pass the headline on, exaggerate first when nothing would be noticed, observe the real page. `--print` shows it without writing.

## MCP server

`nudg mcp` serves the same capabilities as tools over stdio, with no dependencies:

| Tool | What it does |
|---|---|
| `nudg_guide` | The format on one page, including which field to change for "bouncier", "snappier", and so on. |
| `nudg_validate` | Diagnostics with codes, JSON pointers and fix hints. Takes a `file`, or `source` to check text before writing it. |
| `nudg_simulate` | States and values over time for a list of events, with a per-property summary. |
| `nudg_plot` | A motion graph image. |
| `nudg_compare` | Two versions under the same events: a perceptibility verdict first (imperceptible / subtle / clear, per property), then real A/B filmstrips (with `html`; both versions as files) or one graph with both curves. With `html` it also writes the side-by-side page (its path is in the result; `page` chooses it) and tells the person to open it. Proposes an exaggerated version when nothing would be noticed. |
| `nudg_render` | Real frames of the component as a filmstrip image, from the host page (needs Chrome). |
| `nudg_critique` | Whether the motion is good: every transition checked against the platforms' motion guidelines and accessibility rules, each finding with a pointer, a fix and its source. |
| `nudg_share` | Prepares a counts-only usage summary and a prefilled GitHub issue link, with the person's note, for them to submit. Sends nothing by itself. |
| `nudg_observe` | Host truth: opens the running page, performs actions, measures the element every frame, and judges what the page showed against the file (played / differs / never shown / nothing moved). |

To use it from Claude Code (paths relative to the project the agent works in):

```sh
claude mcp add nudg -- npx -y @nudg/core mcp
```

Other clients take the same command: `{ "command": "npx", "args": ["-y", "@nudg/core", "mcp"] }`. From a clone, use `node /path/to/nudg/src/cli.ts mcp` instead.

The server process lives as long as the client's session, so a newly published version is picked up only when the client reconnects (restart the session, or `/mcp` reconnect in Claude Code). Until then the tools are the version that was running when the session started.

## React adapter

```tsx
import { useNudg } from "@nudg/core/react";
import toggle from "./toggle-drag.nudg.json";

function Toggle({ checked }: { checked: boolean }) {
  const { bind, state, send } = useNudg(toggle);
  useEffect(() => void send(checked ? "host.check" : "host.uncheck"), [checked]);
  return (
    <button ref={bind("track")} aria-pressed={state.includes("on")}>
      <span ref={bind("knob")} />
    </button>
  );
}
```

`bind(name)` returns a stable ref callback. Values go straight to the elements' styles, so the component doesn't re-render while things move; `state` updates only when the state changes. The hook takes a JSON object (compiled once, with `files` for its imports) or a compiled program. React 18 or later is an optional peer dependency.

**Exits.** A file's `hidden` state can slide a toast out over 0.3 s, but if the component unmounts the moment the app dismisses it, nothing of that is ever seen (`nudg observe` reports it as "never shown"). Tell the hook which states mean gone, and render nothing only once it says so:

```tsx
function Toast({ onGone }: { onGone: () => void }) {
  const { bind, send, present } = useNudg(toast, { state: ["shown"], exit: "hidden", onExit: onGone });
  if (!present) return null;
  return <div ref={bind("toast")} onClick={() => send("host.hide")}>Saved</div>;
}
```

`present` turns false once the machine has entered an `exit` state and every value has come to rest; `onExit` fires then, once. For a list of toasts, the parent removes the item in `onExit`, not when it decides to dismiss: dismissing is an event (`send("host.hide")`, or the file's own timer), removal is the consequence. Showing the component again (an event that leaves the exit state) makes `present` true again.

## DOM adapter

```js
import { compileUrl, play } from "@nudg/core/dom";

const { program, diagnostics } = await compileUrl("/toggle.nudg.json");
const player = play(program, document.querySelector(".settings"));
```

- **Binding:** elements with `data-nudg="name"` under the root, plus `options.bind`. Unbound targets and undeclared names are reported (`player.unbound`, `player.unknown`) and logged.
- **Input:** `pointerdown` is `down`, `click` is `tap` (so keyboard activation of a button also taps), and a release is `up` over the element or `cancel` outside it. For targets the file drags, travel past 4 px is `dragstart`, pointer moves become `drag.x` / `drag.y` samples, the release adds `dragend`, the click that follows is swallowed, and `touch-action: none` keeps the page from scrolling instead. Pointer enter and leave (not touch) are `hoverstart` / `hoverend`; `focus` and `blur` map directly.
- **Keyboard (0.3):** a `keydown` on a bound element (or inside it) becomes `target.key.<name>` when the file has a transition for it; the browser default is then prevented. Keys the file doesn't listen for pass through. `reducedMotion` in the options overrides the system `prefers-reduced-motion`, which the adapter follows by default. `player.values()` returns the values last applied, and `onFrame(values)` is called after every applied frame, for `aria-valuenow` and the like.
- **State in CSS:** every bound element carries `data-nudg-state` with the active states (`"checked/on press/up"`), so styles can depend on state without any code: `.spinner[data-nudg-state~="refreshing"] { animation: spin 0.8s linear infinite }`. This is how continuous decoration such as a loading spin is done today.
- **Exits:** `{ exit: "hidden", onExit }` names the states that mean gone. `player.present()` turns false, and `onExit` is called once, when the machine has entered one of them from elsewhere and every value has settled: remove or hide the element then, so the exit motion is seen. Mounting in an exit state doesn't count as an exit.
- **App events and state:** `player.send("host.check")` sends an app event, `player.input(name, value)` an input sample, `{ state: ["on"] }` starts somewhere other than `initial`, and `onState` reports state changes. `player.bind(name, element)` binds an element later and returns a function that unbinds it.
- **Layout (0.4):** for a file that measures, the adapter reports each target's untransformed box (offsets) and natural size (scroll size) when it starts and when an element is bound later, and again from a `ResizeObserver`, on window resize and when fonts load. Values move to the new place with their motion. Measuring a size that the same file animates on the same element would feed back on itself; measure the content's `naturalHeight` instead of the panel's `height`.
- **Output:** `x`, `y`, `rotation`, `scale`, `scaleX`, `scaleY` become one `transform` (translate, then rotate, then scale, around the element's `transform-origin`). `opacity`, `width` and `height` map directly. `color` is `fill` on SVG elements and `background-color` otherwise. nudg writes only the styles for properties the file declares.
- **Clock:** real time by default. `{ clock: "manual" }` plus `player.render(t)` draws exact moments, for tests and frame rendering. The demo exposes this as `?at=0.25&send=toggle:track.tap@0.1`. `{ speed: 0.25 }` plays everything, timers included, at quarter speed, for judging a motion by eye; `player.now()` is the player's current time.
- **Mirroring and recording:** `onEvent(item, t)` is called for every event and input sample the adapter itself produces from the DOM (not for `send` and `input` calls), so one player's interaction can be forwarded to another (the examples site's compare mode) or recorded as a session for `nudg simulate`.

## Seeing motion

Two ways to look at an interaction, for people and for multimodal models. Both check the **file**: what the values and states do over time. Whether the **app** shows it (the element exists, isn't unmounted on click, isn't covered) is for `nudg render --html` with the real markup, and for tests that drive the real page.

- **`nudg plot`** draws a motion graph: each property over time, with state bands, events, the target, overshoot and settle times. It needs nothing but the file (PNG output uses a local Chrome; SVG doesn't).
- **`nudg render`** draws real frames of the component as one filmstrip PNG. It takes the host page's markup and styles (`--html`), plays the file on a manual clock in headless Chrome, and captures each `--at` time (or `--frames` evenly spaced ones). The page's own scripts don't run. Set `NUDG_CHROME` if Chrome isn't found.

## Native feel on every platform

Platform motion ships as nudg libraries, written in the same format as everything else and taken from the platforms' own published values:

| Library | Source | Native names | Values |
|---|---|---|---|
| [`motion/apple.nudg.json`](../examples/motion/apple.nudg.json) | SwiftUI `Spring` presets (iOS 17+) | `smooth`, `snappy`, `bouncy` | duration 0.5 s; bounce 0, 0.15, 0.3 |
| [`motion/material-expressive.nudg.json`](../examples/motion/material-expressive.nudg.json) | androidx Material 3 `ExpressiveMotionTokens` | `spatial-default/fast/slow`, `effects-default/fast/slow` | spatial (ratio, stiffness) 0.8/380, 0.6/800, 0.8/200; effects 1.0 with 1600, 3800, 800 |
| [`motion/material-standard.nudg.json`](../examples/motion/material-standard.nudg.json) | androidx Material 3 `StandardMotionTokens` | same | spatial 0.9 with 700, 1400, 300; effects as above |

nudg's `duration` + `bounce` is SwiftUI's model, and `stiffness` + `dampingRatio` is Compose's, so the numbers are copied, not approximated.

Every platform library also defines the same **common names**, so a file written against them changes feel by changing one line:

| Common name | Meaning | Apple | Material Expressive |
|---|---|---|---|
| `standard` | the default spatial spring | snappy | spatial-default |
| `quick` | faster | snappy at 0.3 s | spatial-fast |
| `gentle` | slower, calmer | smooth | spatial-slow |
| `playful` | the bounciest | bouncy | spatial-fast |
| `fade` | for color and opacity; never bounces | smooth at 0.35 s | effects-default |

```json
"import": ["./motion/apple.nudg.json"],
"animate": { "knob.x": "standard", "track.color": "fade" }
```

The libraries ship in the npm package (`node_modules/@nudg/core/examples/motion/`). A nudg file's `import` is a path relative to the file, so copy the library you want next to your files, or point the import at the installed copy.

Use the common names by default. Use a native name (`snappy`, `spatial-fast`) when the point is to match a platform exactly, for example a web view that must feel like the iOS app beside it. See [`examples/ios-toggle.nudg.json`](../examples/ios-toggle.nudg.json) and [`examples/material-switch.nudg.json`](../examples/material-switch.nudg.json): the same machine, a different import.

Host markup follows the [WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/patterns) patterns (`role="switch"`, `aria-checked`), so the examples are the web's canonical components with platform motion.
