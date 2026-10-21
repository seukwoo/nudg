# nudg — working notes for Claude

Read README.md first; it is the landing page people see on GitHub, so keep it short and visual. Development priorities and status are maintained in [docs/roadmap.md](docs/roadmap.md). The vision, principles, scope, design decisions and open questions are in docs/design.md, the grammar is in docs/spec.md, and the tools and adapters are in docs/usage.md.

## Conventions

- Personal open-source project. Write everything from scratch; never copy code or docs from other repositories on this machine.
- This repo has its own git identity and credential helper (`seukwoo`). Don't change them, and don't push with any other GitHub account.
- The user writes in Korean. Reply in Korean; repo docs and code are in English.
- Design first, code second. Settle scope and grammar through discussion before scaffolding. Open questions go into docs/design.md; don't paper over them with assumptions.
- `main` is protected: every change goes through a branch and a pull request, CI must pass, and history stays linear (merge with `gh pr merge --rebase`). Open the PR, then wait for the user's go-ahead before merging.

## Development plan

Read [docs/roadmap.md](docs/roadmap.md) for the current baseline, next work and completion criteria. Keep the queue there so this file does not retain completed tasks as next steps. Open technical choices stay in [docs/design.md](docs/design.md#open-questions); settle them when a concrete case requires a decision.

The judge workflow is grounded in docs/devlog.md ("the second review"): the person should be able to see and judge a change quickly. nudg stays independent of the user's other projects; findings from using it elsewhere go to the devlog and inform the roadmap.

The npm package is `@nudg/core` (the bare name `nudg` is blocked by npm's similar-name filter; the CLI command is still `nudg`). Releases are published by `.github/workflows/release.yml` when a GitHub release is published (npm trusted publishing, no token); the user owns the npm account and its trusted-publisher setting. Cutting a release means: a release-prep PR (version, changelog, docs), merge, tag `vX.Y.Z`, then `gh release create`.

## Working rules for the code

- `src/core/` must not use Node or DOM APIs. Platform code goes in `src/node/`, `src/dom/`, and so on.
- Behavior changes start in `spec/conformance/derive.py`; regenerate the cases, then make the runtime pass.
- Every validator error has a stable code, a JSON pointer, and a hint that says how to fix it.
- Record notable problems (design dead ends, bugs, tooling or release issues) in `docs/devlog.md` as they happen: problem, cause, resolution, lesson.
- The README's images in `docs/media/` are generated from the examples by `npm run media`. Regenerate them when those examples or the motion math change.
- Node runs the TypeScript directly, so use erasable syntax only (no enums, namespaces, or parameter properties) and `.ts` import paths.
