# ADR-0001: Architecture-As-Code Format

- **Status:** Accepted
- **Decision date:** 2026-07-15
- **Recorded:** 2026-07-22

## Context

The repository needed one reviewable model of its systems, containers, external services, and
relationships. This is a retrospective record of the decision implemented in commit `d7b55f2`;
`Proposed` means the record awaits human confirmation, not that the tooling is unimplemented.

The [architecture guide](../architecture/README.md) establishes text-based diagrams in Git,
with Structurizr DSL answering repo-level C4 questions and workspace-owned Mermaid files
answering feature-workflow questions.

## Decision

Use [`workspace.dsl`](../architecture/workspace.dsl) as the source of truth for the repository C4
model. Export its views to committed Mermaid files under `docs/architecture/generated/`, while
keeping hand-written Mermaid workflow diagrams beside the workspaces that own them.

Run Structurizr through the consolidated `structurizr/structurizr` Docker image pinned to the
dated `2026.06.28` tag in both local scripts and CI.

## Consequences

- Architecture changes remain text-reviewable, versioned, and reproducible between local and CI
  environments.
- Generated views must be committed and refreshed whenever `workspace.dsl` changes.
- Contributors need Docker to validate, export, or interactively view the C4 model.
- The dated image pin avoids silent output drift but requires deliberate coordinated upgrades.

## Alternatives

- **Hand-written Mermaid only:** retained for feature workflows, but not for the C4 model because
  Mermaid marks its C4 diagram types experimental and the repository needs one model source.
- **LikeC4:** not adopted; the repository standardized its C4 source and validation/export path on
  Structurizr. The surviving evidence does not preserve a deeper product comparison, so this
  retrospective ADR does not invent one.
- **The older `structurizr/cli` image:** not used because it is frozen and no longer updated.
- **`structurizr/structurizr:latest`:** not used because a floating tag can make identical commits
  validate or export differently over time.

## Compliance

- Run `pnpm run arch:validate` to validate the DSL and `pnpm run arch:export` (or `pnpm run arch`)
  to regenerate the committed views; the commands and pin live in [`package.json`](../../package.json).
- The path-scoped [`docs-architecture.yml`](../../.github/workflows/docs-architecture.yml)
  workflow validates the DSL and diffs a fresh export against committed output.
- Follow the [generated-files rule](../../.agents/rules/change-discipline.md): edit the DSL and
  regenerate output instead of editing `docs/architecture/generated/**` by hand.
