# Using nudg

The CLI, the MCP server, the React and DOM adapters, and the platform motion libraries. Install with `npm install @nudg/core` (Node 22.4 or later), or work from a clone, where Node 23.6 or later runs the TypeScript sources directly.

## CLI

`nudg validate`, `simulate`, `plot` and `render` are the same tools an agent gets over MCP. Every command takes `--json` for machine-readable output, and `nudg --help` lists all options. From a clone, run `node src/cli.ts` in place of `npx nudg`.

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

Stills can't show motion. For the person, write a page instead:

```sh
nudg compare toggle.nudg.json toggle-bouncier.nudg.json --send track.tap@0.05 --html toggle.html --out compare.html
```

`compare.html` plays A and B side by side on the real markup, with the same events, in a loop, with the live values under each. Buttons: replay the events, **press both** (a tap on both at once, with a 0.3 s or 1 s hold), speed 1× / ¼× / ⅒×, pause. The stages also respond to your own taps and drags. The runtime is inlined, so the file works offline and from any folder.

Each property gets a verdict: **imperceptible** (under a device pixel at 1×, or under about three frames), **subtle**, or **clear**. When nothing crosses the threshold it says so and proposes the next turn: look at an exaggerated version first, then dial it back. With `--html` the picture is real A/B filmstrips in two rows, same markup, same moments; without it, both curves on one graph (solid A, dashed B). `--labels now,bouncier` names the rows.

### preset

```sh
nudg preset press > press.nudg.json
nudg preset toast --options '{"duration": 5}'
```

Prints a preset (`press`, `hover`, `toggle`, `toast`) as a nudg file. The same presets are `presets.*` in `@nudg/core` and `@nudg/core/react`, for use without a file: `useNudg(presets.press())`, `playDoc(presets.hover(), element)`.

## MCP server

`nudg mcp` serves the same capabilities as tools over stdio, with no dependencies:

| Tool | What it does |
|---|---|
| `nudg_guide` | The format on one page, including which field to change for "bouncier", "snappier", and so on. |
| `nudg_validate` | Diagnostics with codes, JSON pointers and fix hints. Takes a `file`, or `source` to check text before writing it. |
| `nudg_simulate` | States and values over time for a list of events, with a per-property summary. |
| `nudg_plot` | A motion graph image. |
| `nudg_compare` | Two versions under the same events: a perceptibility verdict first (imperceptible / subtle / clear, per property), then real A/B filmstrips (with `html`) or one graph with both curves. With `html` it also writes `compare.html`, a page that plays both side by side in slow motion, and tells the person to open it. Proposes an exaggerated version when nothing would be noticed. |
| `nudg_render` | Real frames of the component as a filmstrip image, from the host page (needs Chrome). |

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
- **App events and state:** `player.send("host.check")` sends an app event, `player.input(name, value)` an input sample, `{ state: ["on"] }` starts somewhere other than `initial`, and `onState` reports state changes. `player.bind(name, element)` binds an element later and returns a function that unbinds it.
- **Output:** `x`, `y`, `rotation`, `scale`, `scaleX`, `scaleY` become one `transform` (translate, then rotate, then scale, around the element's `transform-origin`). `opacity`, `width` and `height` map directly. `color` is `fill` on SVG elements and `background-color` otherwise. nudg writes only the styles for properties the file declares.
- **Clock:** real time by default. `{ clock: "manual" }` plus `player.render(t)` draws exact moments, for tests and frame rendering. The demo exposes this as `?at=0.25&send=toggle:track.tap@0.1`.

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
