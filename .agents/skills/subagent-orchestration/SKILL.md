---
name: subagent-orchestration
description: Orchestrate subagents for complex plan execution, parallel research, independent reviews, and implement-review loops. Use when executing a plan with independent or dependent tracks, when the user asks for subagents, agent teams, parallel work, or isolated context, or when a focused reviewer loop would improve quality.
metadata:
  created: '2026-07-03'
  status: 'baseline'
  portability: 'cross-tool'
  last-reviewed: '2026-07-03'
---

# Subagent Orchestration

## Purpose

Coordinate multiple focused agent contexts when a task benefits from parallelism, isolated research, or a worker-reviewer loop, while keeping final integration and validation in the main session.

## When To Use

- Executing an implementation plan with independent or sequenced tracks.
- Running parallel research, audit, test-design, or code-review passes.
- Building implement -> review -> revise loops for multi-file or high-risk changes.
- Delegating noisy exploration so the main context stays focused on decisions and final synthesis.

## When Not To Use

- A simple single-file or low-risk change is faster in the main session.
- Subtasks require frequent user back-and-forth, credential entry, or product decisions that should stay in the main session.
- Required approvals cannot reliably surface in the current subagent runtime.
- Implementation subtasks would write overlapping files without worktree or branch isolation.
- The needed tools, MCP servers, repo access, or permissions are unavailable to the subagent runtime.
- The current tool has no callable subagent mechanism; do the work directly and report that orchestration was not available.

## Inputs

- User goal, plan, acceptance criteria, and non-goals.
- Task dependencies, file ownership, and validation expectations.
- Available native subagent mechanism for the current tool.
- Relevant role specs, such as investigator, implementer, reviewer, tester, or docs maintainer.

## Related Role Specs

- [task-analyst](../../agents/task-analyst.md): load before orchestration when the goal or acceptance criteria are unclear.
- [plan](../../agents/plan.md): load when the work needs a dependency-aware implementation plan first.
- [implement](../../agents/implement.md): use for write-capable worker subtasks.
- [code-review](../../agents/code-review.md): use for read-only review loops.
- [tests](../../agents/tests.md): use when validation design or test coverage is a dedicated subtask.

## Workflow

1. Decide whether subagents are worth the overhead. Prefer the main session for small, obvious, or tightly coupled work.
2. Build a task graph:
   - Identify tasks that can run in parallel.
   - Identify tasks that must wait for earlier outputs.
   - Assign write-capable tasks non-overlapping file ownership.
   - Keep shared-file edits sequential unless the tool supports isolated worktrees or branches.
3. Pick roles:
   - `investigator` for read-only discovery, options, or risk analysis.
   - `worker` for focused implementation with clear file ownership.
   - `reviewer` for independent review using `APPROVED`, `NEEDS_CHANGES`, or `BLOCKED`.
   - `tester` for validation strategy, test gaps, or focused failure analysis.
4. Write short prompts. Include only task-specific details the subagent would not already have from repo context:
   - Specific task and acceptance criteria.
   - Target paths, ownership boundaries, and non-goals.
   - Required validation or evidence.
   - Expected output marker and format.
5. Launch independent read-only or disjoint-write tasks in parallel through the current tool's native mechanism. Do not invent commands from another tool.
6. For review loops, cap default iteration at two worker-reviewer cycles. Use more only when the remaining findings are concrete and progress is visible; do not exceed five cycles without a clear reason.
7. Aggregate results in the main session:
   - Read each subagent result.
   - Resolve contradictions and dropped assumptions.
   - Inspect the combined diff when files changed.
   - Run the repo's smallest relevant validation, then broader checks when risk warrants.
8. Report what was delegated, what changed, validation evidence, and any unresolved risks.

## Prompt Template

Use a compact task prompt like this, adapting fields to the subtask:

```text
Task: <one focused objective>
Scope: <paths, modules, or questions>
Boundaries: <non-goals and files not to touch>
Acceptance: <observable done condition>
Validate: <command, checklist, or evidence>
Output: APPROVED | NEEDS_CHANGES | BLOCKED, then concise findings or summary
```

Do not restate full repo rules, style guides, or tool instructions when the subagent runtime already loads them. If that is uncertain, include only the critical boundary that would make the task unsafe if missed.

## Review Loop Contract

Reviewers should return:

- `APPROVED` when no blocking issue remains.
- `NEEDS_CHANGES` with specific file references, impact, and the smallest required fix.
- `BLOCKED` when missing access, missing context, approval requirements, or conflicting instructions prevent a reliable review.

Workers should revise only the scoped files needed to address `NEEDS_CHANGES`, then re-run the relevant validation before asking for another review.

## Red Flags

- Parallel workers edit the same file or migration sequence.
- A subagent result is accepted without main-session synthesis.
- The final response claims validation from a subagent but the main session never checked the integrated result.
- Prompts copy long repo rules instead of task-specific context.
- The workflow depends on tool-specific commands, roles, or pipeline APIs that are not available in the current environment.
- A reviewer is used for a trivial change where a direct self-check is enough.
