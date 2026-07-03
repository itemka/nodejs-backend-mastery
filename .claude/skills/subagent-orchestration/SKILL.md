---
name: subagent-orchestration
description: Orchestrate subagents for complex plan execution, parallel research, independent reviews, and implement-review loops. Use when executing a plan with independent or dependent tracks, when the user asks for subagents, agent teams, parallel work, or isolated context, or when a focused reviewer loop would improve quality.
argument-hint: '[plan or complex task]'
---

# Subagent Orchestration

Canonical instructions live in `.agents/skills/subagent-orchestration/SKILL.md`.

When this skill is selected:

1. Read `AGENTS.md`.
2. Read `.agents/README.md` and the rules under `.agents/rules/`.
3. Read `.agents/skills/subagent-orchestration/SKILL.md`.
4. Follow the `.agents` skill as the source of truth.
5. Use Claude-native subagents, forks, or agent teams only when they fit the task and file-ownership boundaries.
