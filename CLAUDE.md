# nudg — working notes for Claude

Read README.md first. It holds the vision, principles, scope, and the design decisions already made.

## Conventions

- Personal open-source project. Write everything from scratch; never copy code or docs from other repositories on this machine.
- This repo has its own git identity and credential helper (`seukwoo`). Don't change them, and don't push with any other GitHub account.
- The user writes in Korean. Reply in Korean; repo docs and code are in English.
- Design first, code second. Settle scope and grammar through discussion before scaffolding. Open questions go into the README; don't paper over them with assumptions.
- Don't merge or push without the user's go-ahead.

## Next step

Design the minimal grammar by expressing one toggle (states, transitions, a spring-driven value). Use the eight design decisions in the README as the checklist. Settle syntax (JSON / JSON superset / small DSL) as part of this.
