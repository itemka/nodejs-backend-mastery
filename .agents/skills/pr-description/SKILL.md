---
name: pr-description
description: Generate concise PR titles, summaries, and logical change breakdowns from branch and working-tree diffs. Use when asked to write a PR description, prepare PR text, create a pull request, or summarize branch changes for review.
metadata:
  created: '2026-07-03'
  status: 'baseline'
  portability: 'cross-tool'
  last-reviewed: '2026-10-30'
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
- Extra sections the user explicitly requests.
- Validation results, issue links, migration notes, or release constraints when
  needed to understand the change or a requested section.

## Supporting Files

- [pr-description-template](pr-description-template.md): concise PR title,
  summary, and changes, plus guidance on requested extras.
- [pr-readiness checklist](../../checklists/pr-readiness.md): final readiness
  checks before presenting or opening a PR.

## Related Workflows

- [commit-preparation](../commit-preparation/SKILL.md): use when the user also
  wants commit messages, commit grouping, or staged-only commit text.

## Related Role Specs

- [delivery](../../agents/delivery.md): load for full handoff work that includes
  PR text and other handoff notes. Keep the PR body within this skill's output rules.

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
8. Use [pr-description-template](pr-description-template.md) for the output
   shape. Always include the title, summary, and changes.
9. Add extra sections only under the rules below. Report validation and other
   handoff details outside the PR body unless they meet those rules.

## Writing Rules

- Use B2-level English: short sentences, familiar words, and direct explanations.
  Keep technical terms only when they help the reader understand the change.
- Title: short, one line, action-oriented, and specific. Use it as the GitHub PR
  title; do not repeat it as a heading in the PR body.
- Summary: 1-2 short sentences explaining the main change and why it is needed.
- Changes: always include a short bullet list, even for a small PR. Use one
  bullet per logical change and focus on what changed for the reader.
- Keep the summary and bullets brief and informative. Avoid repeating the same
  sentence in both sections or listing each file and implementation step.
- Do not include code snippets, version tables, file lists, or long logs by default.
- Do not include secrets, private URLs, credentials, or local absolute paths.

## Extra Sections

- Default to only the title, summary, and changes. These rules also apply when
  PR text is part of a larger commit or delivery handoff.
- Add validation, risks, rollback, migrations, checklists, issue links, or other
  sections when the user explicitly asks for them. Include only the requested
  extras; available context or a template placeholder is not a request.
- CI reports routine validation. Keep commands, results, and missing-check notes
  outside the PR body unless the user asks for a Validation section.
- In rare cases, include a brief essential note without a request if leaving it
  out would prevent a safe merge or release, such as a breaking change or a
  required migration step. Put it in the summary or changes when it fits; add a
  separate section only if necessary. Routine risk or rollback notes do not qualify.
- Add screenshots, recordings, and examples only when the user explicitly asks.
- An existing repository PR template does not make extra sections mandatory by
  itself. Omit unused headings, placeholders, and empty checklist items.

## Output Format

- Title.
- Summary.
- Changes.
- Extra sections only under the rules above.

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
