---
name: branch-naming
description: Branch name format and conventions for creating or suggesting git branches. Use when asked to name, create, rename, or choose a git branch.
metadata:
  created: '2026-07-03'
  status: 'baseline'
  portability: 'cross-tool'
  last-reviewed: '2026-07-03'
---

# Branch Naming

## Purpose

Create consistent, readable branch names that mirror the repo's Conventional
Commit type and scope style without ticket numbers.

## Format

```text
<type>/<scope>/<kebab-case-summary>
```

When there is no clear stable touched scope, omit it:

```text
<type>/<kebab-case-summary>
```

## Rules

- Prefix with the appropriate Conventional Commit type: `feat`, `fix`, `refactor`, `perf`, `style`, `test`, `docs`, `build`, `ci`, `chore`, or `revert`.
- Prefer a stable scope after the slash when the work maps to a package, app, feature, or agent surface.
- Put the kebab-case summary after the scope and a second slash.
- Write the summary in kebab-case with a concise task description, usually 2-6 words after the scope.
- Use lowercase ASCII letters, numbers, and hyphens only.
- Do not include ticket numbers, issue IDs, or tracker keys in branch names unless the user explicitly overrides this convention.
- Numbers are fine when they are part of the subject, such as `node-24`, `api-v2`, or `oauth2`.
- Do not use Conventional Commit punctuation in branch names: no parentheses, colons, spaces, underscores, trailing slashes, trailing hyphens, or special characters.
- Do not add extra slash-separated segments beyond `type`, optional `scope`, and `summary`.
- Do not repeat the scope in the summary when the scope already carries it.

## Type Selection

- Use `feat` for new user-visible capability.
- Use `fix` for bug fixes and regressions.
- Use `refactor`, `perf`, `style`, `test`, `docs`, `build`, or `ci` when the branch is limited to that kind of work.
- Use `chore` for maintenance that does not fit a more specific type.
- Use `revert` only for reverting prior changes.

## Scope Prefix Selection

Use the same scope prefix that would appear in the commit title. Pick the
primary touched repo area, package, app, workspace, feature, or agent surface.

Examples of scope sources:

- App or workspace folder names from the repo map.
- Shared package names.
- Stable feature or layer names used in nearby commits.
- `agents` for AI-agent docs, skills, commands, hooks, and tool adapters.

For multi-area changes, choose the smallest honest shared scope. Omit the scope
when the change is broad repo maintenance or a scope would be forced.

## Examples

- `docs/agents/update-repo-map-guidance`
- `feat/cli-output/add-terminal-theme`
- `feat/llm-chat/enable-web-search`
- `feat/rag-pipeline/add-retrieval-service`
- `fix/shop-mvc-express/enhance-html-response-handling`
- `test/llm-chat/cover-tool-streaming`
- `chore/update-node-dependencies`

## Invalid Examples

- `feature/add-discount-code` - use `feat`, not `feature`.
- `feat/161209-add-discount-code` - do not include ticket numbers.
- `fix/JIRA-123-update-switch-price-text` - do not include tracker keys.
- `docs(agents): update repo map guidance` - use branch-safe syntax, not commit-title syntax.
- `docs/agents-update-repo-map-guidance` - split type, scope, and summary with slashes when scope is present.
- `FEAT/add-discount-code` - no uppercase letters.
- `feat/add_discount_code` - use hyphens, not underscores.
- `feat/agents/update/extra` - do not add extra slash-separated segments.

## Workflow

1. Identify the main purpose of the branch.
2. Choose the closest Conventional Commit type.
3. Choose the same scope you would use in a commit title, when a stable scope is clear.
4. Convert the task summary to a short kebab-case description.
5. Remove ticket numbers, issue IDs, tracker keys, filler words, and terms already covered by the scope.
6. Before creating or renaming a branch, follow repo git-safety rules and avoid overwriting or moving unrelated work.

## When Not To Use

- The user provides an exact branch name and asks to use it unchanged.
- The user explicitly asks for a different branch convention.
