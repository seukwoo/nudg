# nudg — working notes for Claude

Read README.md first. It holds the vision, principles, scope, and the design decisions already made.

## Conventions

- Personal open-source project. Write everything from scratch; never copy code or docs from other repositories on this machine.
- This repo has its own git identity and credential helper (`seukwoo`). Don't change them, and don't push with any other GitHub account.
- The user writes in Korean. Reply in Korean; repo docs and code are in English.
- Design first, code second. Settle scope and grammar through discussion before scaffolding. Open questions go into the README; don't paper over them with assumptions.
- `main` is protected: every change goes through a branch and a pull request, CI must pass, and history stays linear (merge with `gh pr merge --rebase`). Open the PR, then wait for the user's go-ahead before merging.

## Next step

Format v0.1 (stage 0) and v0.2 (stage 1: drag, `follow`, `nearest`, `map`, machine-level `when`, hover/focus/host events) are in the README, with JSON Schemas, a conformance suite, the TypeScript core, a CLI (`validate`, `simulate`, `plot`, `render`, `mcp`), and DOM and React adapters with a demo. Published on npm as `@nudg/core` (the bare name `nudg` is blocked by npm's similar-name filter; the CLI command is still `nudg`); `npm publish` is done by the user, who owns the npm account. Next, to agree with the user first: v0.3 (layout measurement for a tab indicator, `auto` sizes, `%` units, decay) or a stage-2 case (nested screens, composing machines). Settle open questions only when a case forces them.

## Working rules for the code

- `src/core/` must not use Node or DOM APIs. Platform code goes in `src/node/`, `src/dom/`, and so on.
- Behavior changes start in `spec/conformance/derive.py`; regenerate the cases, then make the runtime pass.
- Every validator error has a stable code, a JSON pointer, and a hint that says how to fix it.
- Record notable problems (design dead ends, bugs, tooling or release issues) in `docs/devlog.md` as they happen: problem, cause, resolution, lesson.
- Node runs the TypeScript directly, so use erasable syntax only (no enums, namespaces, or parameter properties) and `.ts` import paths.
