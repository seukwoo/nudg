# nudg — working notes for Claude

Read README.md first; it is the landing page people see on GitHub, so keep it short and visual. The vision, principles, scope, design decisions and open questions are in docs/design.md, the grammar is in docs/spec.md, and the tools and adapters are in docs/usage.md.

## Conventions

- Personal open-source project. Write everything from scratch; never copy code or docs from other repositories on this machine.
- This repo has its own git identity and credential helper (`seukwoo`). Don't change them, and don't push with any other GitHub account.
- The user writes in Korean. Reply in Korean; repo docs and code are in English.
- Design first, code second. Settle scope and grammar through discussion before scaffolding. Open questions go into docs/design.md; don't paper over them with assumptions.
- `main` is protected: every change goes through a branch and a pull request, CI must pass, and history stays linear (merge with `gh pr merge --rebase`). Open the PR, then wait for the user's go-ahead before merging.

## Next step

Format v0.1–v0.3 are in docs/spec.md (drag, `follow`, `nearest`, `map`, machine-level `when`, hover/focus/host/key events, `after` timers, `step`/`commit`, reduced motion), with JSON Schemas, a conformance suite, the TypeScript core, DOM and React adapters, presets, platform motion libraries, an examples site, and a CLI + MCP server (`validate`, `simulate`, `plot`, `render`, `compare`, `observe`, `preset`, `mcp`). Published on npm as `@nudg/core` (the bare name `nudg` is blocked by npm's similar-name filter; the CLI command is still `nudg`); `npm publish` is done by the user, who owns the npm account.

The current thesis (docs/devlog.md, "the second review"): the format is already good for an AI to write; the value to build is letting the person judge a change in two seconds. Judge tools so far: `compare` (verdict first, marked A/B filmstrips, a `compare.html` page that plays both side by side in slow motion) and `observe` (host truth: the real page tapped and measured, judged against the file). Next, to agree with the user first: exit/presence handling in the adapter (keep an element until its motion settles), a live A/B view in the examples site, then v0.4 grammar (layout measurement for a tab indicator, `auto` sizes, `%` units, decay) when a case forces it. nudg stays independent of the user's other projects (no dependency either way); findings from using it elsewhere go to the devlog. Settle open questions only when a case forces them.

## Working rules for the code

- `src/core/` must not use Node or DOM APIs. Platform code goes in `src/node/`, `src/dom/`, and so on.
- Behavior changes start in `spec/conformance/derive.py`; regenerate the cases, then make the runtime pass.
- Every validator error has a stable code, a JSON pointer, and a hint that says how to fix it.
- Record notable problems (design dead ends, bugs, tooling or release issues) in `docs/devlog.md` as they happen: problem, cause, resolution, lesson.
- The README's images in `docs/media/` are generated from the examples by `npm run media`. Regenerate them when those examples or the motion math change.
- Node runs the TypeScript directly, so use erasable syntax only (no enums, namespaces, or parameter properties) and `.ts` import paths.
