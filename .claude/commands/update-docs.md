---
description: Update developer documentation using the repo's shared documentation workflow.
argument-hint: '[doc surface or change description]'
---

Read and execute `.agents/commands/update-docs.md` as the canonical command
body.

For AI-agent documentation, this command should check current official docs and
recent official changelogs, release notes, or dated best-practice pages for the
referenced tools before editing. Search the last 30 days first; broaden to 90
days only if no useful dated updates are found. Report the sources checked and
recency window used.

Also follow:

- `AGENTS.md`
- `.agents/README.md`
- `.agents/rules/project.md`
- `.agents/rules/repo-map.md`
- `.agents/rules/change-discipline.md`

Use the user-provided arguments as the documentation task brief.
