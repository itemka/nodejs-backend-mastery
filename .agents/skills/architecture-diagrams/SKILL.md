---
name: architecture-diagrams
description: Architecture and workflow diagram maintenance for the Structurizr C4 model and Mermaid feature flows. Use when a change adds, removes, or reshapes apps, containers, external dependencies, data stores, API boundaries, or alters a request flow, call sequence, state lifecycle, or retry/async behavior.
metadata:
  created: '2026-07-04'
  status: 'baseline'
  portability: 'cross-tool'
  last-reviewed: '2026-07-13'
---

# Architecture Diagrams

## Purpose

Keep the text-based diagrams in sync with the code, in the same PR as the
change. Structure lives in the Structurizr C4 model; feature workflows live in
Mermaid files under the owning workspace's `docs/` directory. Conventions
(formats, layout, diagram direction) are defined in
[docs/architecture/README.md](../../../docs/architecture/README.md) — read it
before creating or editing any diagram.

## When To Use

- A change adds, removes, or renames an app, container, external dependency,
  data store, or public API boundary.
- A change alters a request flow, call sequence, state transitions, or
  retry/error/async behavior of an existing feature.
- The user asks to create, update, or review architecture or workflow diagrams.

## When Not To Use

- Pure refactors that keep boundaries, flows, and contracts unchanged.
- Changes to scaffold apps or `_todo/` material that is not runnable yet.

## Workflow

1. Classify the change: structural (systems/containers/relationships) →
   `docs/architecture/workspace.dsl`; behavioral (step-by-step flow) →
   `workspaces/<area>/<workspace>/docs/<flow>.md`. A change can be both.
2. Read the diagrams you are about to touch and verify them against the
   current source code, not against READMEs or memory.
3. For `workspace.dsl` edits: keep views on `autoLayout lr`, then run
   `pnpm run arch` (validates, then re-exports `docs/architecture/generated/`).
   Include the regenerated files in the same change; never hand-edit
   `generated/`.
4. For Mermaid edits: follow the direction conventions in
   `docs/architecture/README.md` (default `flowchart LR`; `TD` for long
   lifecycles; no experimental Mermaid C4 diagram types). Verify rendering in
   a Markdown preview or on the GitHub branch.
5. One diagram answers one question — split diagrams rather than grow one past
   ~15 nodes.

## Validation

- `pnpm run arch:validate` after any `workspace.dsl` change (Docker required).
- `pnpm run arch:export` when views changed; commit the regenerated output.
- Mermaid blocks render without errors in preview.

## Safety Rules

- Diagrams must describe code that exists, not planned work.
- Do not add secrets, hostnames, or machine-specific paths to diagrams.
- Do not restate conventions from `docs/architecture/README.md` elsewhere;
  link to it.
