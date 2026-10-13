# nudg — working notes for Claude

Read README.md first. It holds the vision, principles, scope, and the design decisions already made.

## Conventions

- Personal open-source project. Write everything from scratch; never copy code or docs from other repositories on this machine.
- This repo has its own git identity and credential helper (`seukwoo`). Don't change them, and don't push with any other GitHub account.
- The user writes in Korean. Reply in Korean; repo docs and code are in English.
- Design first, code second. Settle scope and grammar through discussion before scaffolding. Open questions go into the README; don't paper over them with assumptions.
- Don't merge or push without the user's go-ahead.

## Next step

The v0.1 grammar is in the README, with a JSON Schema, a conformance suite, a TypeScript reference core, a CLI (`validate`, `simulate`, `plot`, `render`, `mcp`), and a DOM adapter with a demo. Stage 0 tooling is complete: DOM adapter and demo, `nudg plot` / `nudg render`, and the MCP server (`nudg mcp`). The project is MIT-licensed. Next candidates, to agree with the user first: a publishable package (built `dist`, exports pointing at it, removing `private`), then stage 1 design (gestures and follow-style values, decay, React adapter). Settle open questions only when a case forces them.

## Working rules for the code

- `src/core/` must not use Node or DOM APIs. Platform code goes in `src/node/`, `src/dom/`, and so on.
- Behavior changes start in `spec/conformance/derive.py`; regenerate the cases, then make the runtime pass.
- Every validator error has a stable code, a JSON pointer, and a hint that says how to fix it.
- Node runs the TypeScript directly, so use erasable syntax only (no enums, namespaces, or parameter properties) and `.ts` import paths.
