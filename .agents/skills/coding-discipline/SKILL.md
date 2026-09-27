---
name: coding-discipline
description: Guides non-trivial implementation, debugging, refactoring, code review, and multi-step engineering work through an evidence-based decision loop. Use when choices affect correctness, scope, compatibility, or risk to define a finish line, select the least-complex sound approach, constrain the diff, and verify in proportion to impact. Also covers session continuity and whether a task needs working notes, a scratchpad, or a handoff summary. Skip for obvious low-risk mechanical edits.
metadata:
  created: '2026-07-15'
  status: 'baseline'
  portability: 'cross-tool'
  last-reviewed: '2026-09-17'
---

# Coding Discipline

Use this workflow to make non-trivial engineering work auditable: ground decisions in repository evidence, state the intended outcome, control scope, and demonstrate completion.

Treat the always-on [project rules](../../rules/project.md) and [change discipline](../../rules/change-discipline.md) as authoritative.

Pair this cross-cutting workflow with the task-specific skill that owns the detailed procedure and output, such as [implement](../implement/SKILL.md), [debug](../debug/SKILL.md), [refactor](../refactor/SKILL.md), [code-review](../code-review/SKILL.md), or [validate](../validate/SKILL.md).

## Decision Loop

### 1. Ground The Decision

- Inspect the relevant source, tests, configuration, documentation, and current diff before deciding what to change.
- Separate confirmed facts from assumptions. Resolve uncertainty that would materially change correctness, scope, or risk; otherwise state a reasonable assumption and continue.
- Identify the existing project patterns and contracts that constrain the solution.

### 2. Define The Finish Line

- Describe the observable result that will satisfy the request.
- Record material constraints, compatibility requirements, and non-goals.
- Choose the smallest meaningful check that can demonstrate the result.

### 3. Select The Approach

- Prefer an established project pattern that meets the finish line with few moving parts.
- Compare alternatives only when their trade-offs could materially change the result.
- Do not introduce extra behavior, configuration, abstraction, or dependencies without a present requirement.

### 4. Control The Edit

- Keep edits attributable to the requested outcome.
- Exclude unrelated cleanup; report it separately when it is worth preserving for later work.
- Limit incidental cleanup to artifacts made obsolete by the current change.
- Preserve public behavior and shared contracts unless changing them is part of the request.

### 5. Demonstrate The Result

- Run the selected check first, then broaden validation according to impact and risk.
- After three failed attempts at the same failing check, stop and report instead of trying again. Summarize what was tried, what the failure says, and the two most likely causes; repeated attempts are where a fix can turn into silencing the symptom through broader error handling, relaxed assertions, or new fallback defaults.
- Inspect the final diff for accidental scope growth, stale references, and unsupported claims.
- Report the commands run, their results, and anything that remains unverified.

## Working Notes

Three persistence artifacts, three jobs. Pick by the boundary the work actually crosses, and skip the ones it does not.

| Artifact        | Crosses                   | Content                                                                                | Home                                               |
| --------------- | ------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Scratchpad      | Nothing — one session     | Verbatim specifics: paths, symbol names, dependency chains, measured numbers           | The tool's temporary scratch location, uncommitted |
| Handoff summary | An agent or tool boundary | Compressed conclusions: findings, severity, changed files, recommended next action     | The subagent prompt, or the final response         |
| Plan file       | Sessions and tools        | Structured state: steps, `Status`, `Current step`, validation evidence, remaining work | `docs/plan-<short-task-goal>.md`                   |

- Decide on a scratchpad when the exploration starts, not after the answers begin drifting. It earns its keep when a task reads across many modules and the early precise findings would otherwise be pushed out by later verbose output.
- Keep scratchpad entries verbatim. Compression is what a handoff needs; the current session needs the specifics it already paid to discover.
- Skip the scratchpad for short, bounded work, and skip it when a plan file already carries the same state.
- Do not add a separate session-tracking or task-context file to the repository. The plan file is the only committed progress artifact; anything shorter-lived stays in the tool's scratch location.
- Naming, lifecycle, and the file-vs-chat decision for the plan file are owned by [plan](../plan/SKILL.md) § _Plan Artifact Policy_. The shape of a subagent handoff is owned by [subagent-orchestration](../subagent-orchestration/SKILL.md) § _Context Passing Contract_.

## Session Continuity

Work that outlives one session continues from the state of the context, not from habit.

- Context still valid and the work is linear → resume the same session.
- Context still valid but two approaches need comparing → branch from it and keep each branch's results separate. A branch inherits the state it was taken from, including anything already stale.
- Context stale or degraded → start fresh and inject a written summary plus the list of files that changed since. Conversation history is append-only: re-reading a modified file adds the new contents without evicting the old, so both versions stay in play and either can drive the next answer.
- Stale-context tells: recommending a fix that is already applied, referring to code that no longer exists, or answering inconsistently about the same file across turns.
- Persist state before restarting. Persist, restart, then inject the summary; the anti-pattern is restarting with nothing written down. What to persist where is the table above.

## Boundaries

- Keep reviews and diagnosis-only requests read-only unless the user also requests implementation.
- Ask for clarification only when the missing information prevents a safe, materially correct choice.
- Stop before destructive or irreversible actions unless the user has authorized them and the consequences are understood.

## Output

Report:

- The intended outcome and material assumptions.
- The focused change or evidence-backed findings.
- The validation performed.
- Remaining risks or open questions, when applicable.
