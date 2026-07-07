# Architecture Diagrams

Text-based diagrams stored in git and maintained in the same PR as the code
they describe. Two formats, split by the question they answer:

- **Structurizr DSL** ([workspace.dsl](./workspace.dsl)) — the C4 model:
  _which systems, containers, and external services exist and how they
  connect_. Single source of truth for architecture.
- **Mermaid** (under [docs/features/](../features/)) — feature workflows:
  _how a specific flow works step by step_ (request flows, call sequences,
  state lifecycles). GitHub renders Mermaid natively in Markdown, PRs, and
  issues, so no tooling is needed to read them.

Do not use Mermaid's `C4Context`/`C4Container` diagram types — Mermaid marks
them experimental. C4 belongs in `workspace.dsl`.

## Layout

```text
docs/
  architecture/
    workspace.dsl   # C4 model source of truth (edit this)
    generated/      # views exported from workspace.dsl (never edit by hand)
    README.md       # this file
  features/
    <app>/<flow>.md # Mermaid workflow diagrams per app/feature
```

Running the CLI or viewer also drops `workspace.json` and `.structurizr/`
next to the DSL; both are local artifacts and gitignored.

## Direction Conventions

Default is **left to right** — pick the direction that keeps the diagram
roughly screen-shaped.

| Diagram purpose                                        | Type and direction                                    | Why                                                                              |
| ------------------------------------------------------ | ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| Request/data/pipeline flow (User → API → Service → DB) | `flowchart LR` (default)                              | Time and causality read left→right like text; screens are wider than tall.       |
| Long lifecycle with many stages and side-branches      | `flowchart TD`                                        | 10+ sequential stages with long labels become unreadably wide in LR.             |
| Who calls whom over time                               | `sequenceDiagram`, participants ordered by call order | The time axis is inherently vertical; participant order is the left→right lever. |
| State lifecycle (created → paid → shipped)             | `stateDiagram-v2` with `direction LR`                 | Linear lifecycles read as a timeline.                                            |
| C4 context/container views                             | Structurizr `autoLayout lr`                           | People/clients on the left, data stores and external systems on the right.       |

Rule of thumb: chains of ≤ ~8 nodes with short labels → LR; deeper chains or
long labels → TD. One diagram answers one question; split rather than grow
past ~15 nodes.

## Commands

All scripts run the consolidated `structurizr/structurizr` Docker image (no
local Java needed). Note: the older `structurizr/cli` image and the Homebrew
`structurizr-cli` formula are frozen and no longer receive updates — use the
consolidated image.

The scripts run the container as your current host user so exported files can
overwrite the checked-out `generated/` directory on Linux and macOS.

```bash
pnpm run arch:validate  # parse + validate workspace.dsl
pnpm run arch:export    # export all views as Mermaid into generated/
pnpm run arch           # validate, then export
pnpm run arch:view      # serve the model as an interactive web UI
```

Re-run `pnpm run arch` after every `workspace.dsl` change and commit the
updated `generated/` output in the same PR. Files in `generated/` are
overwritten on export — never edit them by hand.

## Viewing Diagrams Interactively

`pnpm run arch:view` serves the model with pan/zoom and auto-layout (the
Structurizr Lite successor built into the consolidated image); then open
<http://localhost:8080>.

Feature diagrams in `docs/features/**` render directly on GitHub and in the
VS Code Markdown preview (with built-in Mermaid support or the "Markdown
Preview Mermaid Support" extension). The exported `generated/*.mmd` files do
**not** render as diagrams on GitHub — they are committed for versioning and
diff review only; use `pnpm run arch:view` to see them rendered.

## CI

[.github/workflows/docs-architecture.yml](../../.github/workflows/docs-architecture.yml)
validates `workspace.dsl` and fails if `generated/` does not match a fresh
export, on every PR that touches `docs/architecture/**`. The main CI workflow
ignores `docs/**` entirely, so this is the only gate for diagram changes.

## When To Update What

- Change adds/removes/renames an app, container, external dependency, data
  store, or public API boundary → update `workspace.dsl`, run `pnpm run arch`.
- Change alters a request flow, call sequence, state transitions, or
  retry/error/async behavior → update (or create) the matching
  `docs/features/<app>/<flow>.md`.

Agent workflow details live in
[.agents/skills/architecture-diagrams/SKILL.md](../../.agents/skills/architecture-diagrams/SKILL.md).
