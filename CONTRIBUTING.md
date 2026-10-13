# Contributing to nudg

Thanks for your interest. nudg is early, and the most useful contributions right now are real interactions that the format can't express yet, and bugs in the reference runtime.

## Before you start

- **Design first, code second.** For a new feature or grammar change, open an issue describing the interaction you want to build and why the current format falls short. Grammar is expensive to change later, so it is settled in discussion before code.
- **Open questions live in the [README](README.md#open-questions).** If your change touches one, say which.

## Setup

You need Node 23.6 or later (it runs the TypeScript directly) and Python 3 for the conformance generator. The rendering test needs a local Chrome and is skipped without one; set `NUDG_CHROME` if Chrome is installed but not found.

```sh
npm install
npm test            # conformance suite, schema, core, rendering
npm run typecheck   # also checks that src/core uses no platform APIs
```

## How the repository works

- **The spec is the source of truth.** Behavior is defined by the README grammar plus the conformance suite in [`spec/conformance/`](spec/conformance/), not by the TypeScript runtime.
- **Behavior changes start in `spec/conformance/derive.py`.** Edit it, regenerate the cases with `python3 spec/conformance/derive.py`, then make the runtime pass. Never edit the case JSON by hand.
- **`src/core/` is headless.** No Node or DOM APIs there; platform code goes in `src/node/`, `src/dom/`, and so on.
- **Validator errors are part of the spec.** Every error has a stable code, a JSON pointer, and a hint that says how to fix it.
- **Erasable TypeScript only.** Node runs the sources without a build, so no enums, namespaces, or parameter properties, and imports use `.ts` paths.

## Pull requests

- Keep each pull request to one change, with tests (`npm test` and `npm run typecheck` must pass).
- Write code and docs in English.
- By contributing, you agree that your contribution is licensed under the [MIT License](LICENSE).
