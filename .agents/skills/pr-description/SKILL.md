---
name: pr-description
description: Generate concise PR titles, summaries, and logical change breakdowns from branch and working-tree diffs. Use when asked to write a PR description, prepare PR text, create a pull request, or summarize branch changes for review.
metadata:
  created: '2026-07-03'
  status: 'baseline'
  portability: 'cross-tool'
  last-reviewed: '2026-07-03'
---

# PR Description

## Purpose

Turn branch or working-tree changes into a reviewer-ready PR title, summary,
and logical change breakdown.

## When To Use

- The user asks for a PR title, PR description, PR body, or pull request text.
- The user asks to create a pull request and needs the text prepared first.
- Branch changes need to be summarized for review without preparing commits.

## Inputs

- Current branch and git status.
- Target branch or base branch when provided.
- Branch commits, branch diff, staged diff, and unstaged diff.
- Validation commands and results, when available.
- Issue links, screenshots, migration notes, release constraints, risks, or
  rollback notes when provided.

## Supporting Files

- [pr-description-template](pr-description-template.md): concise PR title,
  summary, logical changes, and optional review sections.
- [pr-readiness checklist](../../checklists/pr-readiness.md): final readiness
  checks before presenting or opening a PR.

## Related Workflows

- [commit-preparation](../commit-preparation/SKILL.md): use when the user also
  wants commit messages, commit grouping, or staged-only commit text.

## Related Role Specs

- [delivery](../../agents/delivery.md): load for full handoff work that includes
  PR text, validation notes, risks, rollback, and follow-ups.

## Workflow

1. Inspect the current branch with `git branch --show-current` and the working
   tree with `git status --short`.
2. Choose the comparison base in this order:
   - User-provided target branch.
   - Remote default branch from `git symbolic-ref --quiet --short refs/remotes/origin/HEAD`.
   - `main`, then `master`, when present locally.
3. If the user asks for staged-only or working-tree-only PR text, honor that
   scope and say which diff was used.
4. If a branch base is available, inspect commits with
   `git log <base>..HEAD --oneline` and inspect committed branch changes with
   `git diff <base>...HEAD`. If `git status --short` is not clean, also
   inspect pending changes with `git diff --cached` and `git diff`; include
   in-scope pending work in the PR text and call out unrelated local changes
   that were excluded.
5. If no base is available or the work is happening on the base branch, use the
   relevant staged and unstaged diffs, and state that no branch comparison base
   was available.
6. Trust the diff over commit messages. Collapse fixup, merge, formatting-only,
   and cleanup commits into the logical change they belong to.
7. Group changes by logical review area, not by file path. Each area should say
   what changed and why it matters.
8. Capture validation from the user context or commands already run. If
   validation is unknown, say it was not provided or not run.
9. Use [pr-description-template](pr-description-template.md) for the output
   shape. Keep optional sections only when they add review value or the repo's
   PR template requires them.

## Writing Rules

- Title: short, one line, action-oriented, and specific.
- Summary: 2-3 sentences explaining what changed and why.
- Changes: one entry per logical area, formatted as `[Area] - [what was done and why]`.
- For small single-concern PRs, omit the Changes section when the Summary is
  enough.
- Do not include code snippets, version tables, or file lists.
- Do not paste long logs; summarize validation results.
- Do not include secrets, private URLs, credentials, or local absolute paths.
- Call out breaking changes, migrations, notable risks, and rollback notes when
  relevant.

## Output Format

- Title.
- Summary.
- Changes, unless the PR is a small single-concern change.
- Validation, when known or worth calling out.
- Risks, rollback, screenshots, examples, migrations, or checklist items only
  when relevant.

## Safety Rules

- Do not push, open a PR, retarget a branch, or mutate remote state unless the
  user explicitly asks.
- Do not claim validation passed if it was not run.
- Do not describe unrelated working-tree changes as part of the PR.
- If the base branch is guessed, mention the assumption outside the PR body.

## When Not To Use

- The user only wants a commit message or commit plan; use
  [commit-preparation](../commit-preparation/SKILL.md).
- No diff or branch context is available.
