# Contributing to nudg

Thanks for your interest. nudg is early, and the most useful contributions right now are real interactions that the format can't express yet, and bugs in the reference runtime.

## Before you start

- **Design first, code second.** For a new feature or grammar change, open an issue describing the interaction you want to build and why the current format falls short. Grammar is expensive to change later, so it is settled in discussion before code.
- **Open questions live in [the design doc](docs/design.md#open-questions).** If your change touches one, say which.
- **Development priorities and status live in [the roadmap](docs/roadmap.md).** Update that plan when work is completed or priorities change.

## Setup

You need Node 23.6 or later (it runs the TypeScript directly) and Python 3 for the conformance generator. The rendering test and the examples-site test drive a local Chrome and are skipped without one; set `NUDG_CHROME` if Chrome is installed but not found.

```sh
npm install
npm test            # conformance suite, schema, core, rendering, the examples site in a browser
npm run typecheck   # also checks that src/core uses no platform APIs
npm run build       # compiles to dist/, which is what the npm package ships
```

`npm pack` builds and packs the package; install the tarball in an empty project to try it the way users will.

## How the repository works

- **The spec is the source of truth.** Behavior is defined by [the format spec](docs/spec.md) plus the conformance suite in [`spec/conformance/`](spec/conformance/), not by the TypeScript runtime.
- **Behavior changes start in `spec/conformance/derive.py`.** Edit it, regenerate the cases with `python3 spec/conformance/derive.py`, then make the runtime pass. Never edit the case JSON by hand.
- **`src/core/` is headless.** No Node or DOM APIs there; platform code goes in `src/node/`, `src/dom/`, and so on.
- **Validator errors are part of the spec.** Every error has a stable code, a JSON pointer, and a hint that says how to fix it.
- **Write down what you learn.** Notable problems and how they were solved go in [`docs/devlog.md`](docs/devlog.md).
- **The README's images are generated.** `npm run media` replays the examples with the runtime and rewrites `docs/media/`; run it after changing those examples or the motion math, and don't edit the SVGs by hand.
- **Erasable TypeScript only.** Node runs the sources without a build, so no enums, namespaces, or parameter properties, and imports use `.ts` paths.

## Repository layout

| Path | What it is |
|---|---|
| [`docs/spec.md`](docs/spec.md) | The format: grammar, motion model, and how values resolve. |
| [`docs/design.md`](docs/design.md) | Principles, scope, design decisions, and open questions. |
| [`docs/roadmap.md`](docs/roadmap.md) | Development priorities, stage status, and completion criteria. |
| [`docs/usage.md`](docs/usage.md) | The CLI, the MCP server, the React and DOM adapters, and the platform motion libraries. |
| [`docs/devlog.md`](docs/devlog.md) | Development log: problems met while building nudg, their causes, and how they were resolved. |
| [`spec/`](spec/) | JSON Schemas for editors and LLM structured output, and [`guide.md`](spec/guide.md), the format on one page for AI agents (served by the `nudg_guide` tool). The validator checks more than the schemas (references, base values, motion names). |
| [`spec/conformance/`](spec/conformance/) | Language-neutral behavior and validation cases. Expected values come from an independent derivation. |
| [`src/core/`](src/core/) | Reference runtime in TypeScript: compiler and validator, motion math, state machine, simulation. No platform APIs. |
| [`src/cli.ts`](src/cli.ts) | `nudg validate`, `simulate`, `plot`, `render` and `mcp`, with `--json` for agents. |
| [`src/node/`](src/node/) | Node helpers: file loading, Chrome discovery, frame rendering over the DevTools protocol, the MCP server. |
| [`src/dom/`](src/dom/) | DOM adapter: `play(program, root)` and `compileUrl(url)`. |
| [`src/react/`](src/react/) | React adapter: the `useNudg` hook. |
| [`examples/`](examples/) | Sixteen interactions, each a nudg file plus a host page with its markup, cataloged in `index.json` with categories, concept tags and prompts to try with an AI. `examples/motion/` holds the platform motion libraries. |
| [`demo/`](demo/) | The examples site: browse by category, tag or search; open one for its source as nudg, HTML and React; edit any file in the playground. Published to [GitHub Pages](https://seukwoo.github.io/nudg/demo/) on every push to `main`. |
| [`scripts/readme-media.ts`](scripts/readme-media.ts) | Generates the README's animated images in `docs/media/`. |

## Pull requests

- Keep each pull request to one change, with tests (`npm test` and `npm run typecheck` must pass).
- Write code and docs in English.
- By contributing, you agree that your contribution is licensed under the [MIT License](LICENSE).
