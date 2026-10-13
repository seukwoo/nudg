# nudg

**The interaction format your AI can nudge.**

nudg is a plain-text format for UI interactions: states, the events that move between them, and the motion in between. It lives in your codebase next to your components. Your AI coding tool writes it, a validator checks it, and a runtime plays it.

> Status: early design. Nothing here is stable yet.

## Why

Today's interactive animation formats are binary files authored in a dedicated studio. That worked when a designer handed a finished asset to an engineer. It doesn't fit how software is built now:

- **Your AI can't edit it.** A binary file is a black box to an LLM. You can't ask for "make the toggle a little bouncier" and get a diff.
- **It can't be reviewed.** No meaningful diff, no code review, no history you can read.
- **It needs the studio.** Every change, however small, goes back through one specific tool.

Meanwhile, more and more UI is written by people working with AI coding tools, moving fast, inside the repo. Interactions should be able to live there too.

nudg is meant to slip into that workflow instead of asking you to leave it.

## What "AI-native" means here

These are concrete requirements, not a slogan. Each one is something the format and tooling must actually do:

1. **Text source.** A small vocabulary an LLM can write correctly without a page of examples. Compact, diffable, stable identifiers for targeted edits.
2. **Validator with fix hints.** Errors are machine-readable and say how to fix them, so an AI can correct its own output in a loop.
3. **Headless simulation.** Send events, advance time, and inspect state without rendering anything, so behavior can be tested, not just looked at.
4. **Frame rendering.** Render any moment to an image so a multimodal model (or a person) can check what it actually looks like.
5. **CLI and MCP from day one.** Every capability is callable by an agent. A visual editor may come later, but the text stays the source of truth.

## Where it starts

**Web UI micro-interactions**: toggles, buttons, loaders, pull-to-refresh, onboarding moments. This is where full animation tools are overkill, CSS alone gets messy once state is involved, and people building with AI coding tools are the most numerous.

From there, the format can grow outward.

## What nudg is not

- **Not a drawing or illustration tool.** Character animation, bones, and mesh deformation belong to tools built for them.
- **Not a design tool.** nudg animates the components you already have. It doesn't replace your design system.
- **Not a general-purpose state management library.** It is scoped to interactions and motion.

## Open questions

- Syntax: JSON, a JSON superset, or a small DSL?
- Minimal core: what is the smallest set of concepts that can express a toggle well? Likely states, transitions, and continuous values.
- Continuous motion: how springs and follow-style values are declared alongside discrete states.
- First runtime target: DOM/CSS, Canvas, or a framework adapter such as React.
- License.
