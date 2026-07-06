---
name: brainstorm
description: Collaborative pre-planning for vague ideas, architecture options, and "how should we build X?" discussions. Use when the user asks to brainstorm, explore options, shape an idea, or compare approaches before implementation planning.
metadata:
  created: '2026-07-03'
  status: 'baseline'
  portability: 'cross-tool'
  last-reviewed: '2026-07-03'
---

# Brainstorm

## Purpose

Turn an early idea into a validated task brief or design direction that is ready for the [plan](../plan/SKILL.md) skill.

Brainstorming is not implementation. It is the collaborative step before an implementation plan, used to clarify intent, constraints, trade-offs, scope boundaries, and success criteria.

## When To Use

- The user asks to brainstorm, explore options, discuss an approach, or asks "how should we build X?"
- The user has an idea but has not decided what to build, why it matters, or which approach fits.
- Multiple viable approaches exist and trade-offs need to be compared before planning.
- The request is too undefined for [plan](../plan/SKILL.md), which assumes a task can already be scoped into implementation steps.

## When Not To Use

- The task is already clear enough for implementation planning; use [plan](../plan/SKILL.md).
- The user asks for code changes or direct implementation; use [implement](../implement/SKILL.md).
- The user asks to debug a failure; use [debug](../debug/SKILL.md).
- The user asks for a factual repo answer; inspect the repo directly and answer without forcing brainstorming.

## Inputs

- User idea, goal, audience, constraints, timeline, and success criteria.
- Existing repo patterns, docs, recent changes, and affected boundaries.
- Known non-goals, risks, dependencies, and validation needs.

## Related Role Specs

- [task-analyst](../../agents/task-analyst.md): load when the request is vague, broad, or missing acceptance criteria.
- [plan](../../agents/plan.md): load after brainstorming when the design direction is ready for implementation planning.
- [backend-architect](../../agents/backend-architect.md): load when backend boundaries, persistence, service contracts, or cross-module architecture choices dominate the discussion.

## Workflow

1. Restate the idea in concrete terms and call out what is still unknown.
2. Inspect only the repo context needed to avoid speculative advice: relevant docs, existing patterns, nearby code, and recent changes when they affect the design.
3. Ask targeted clarifying questions only when the answer would materially change the direction. Prefer one question at a time; use multiple-choice options when the reasonable options are knowable.
4. Identify scope boundaries early. If the idea spans independent subsystems, recommend decomposing it before comparing solutions.
5. Propose 2-3 viable approaches with the recommended option first. For each approach, cover trade-offs, risks, fit with existing architecture, validation implications, and what would be deferred.
6. Challenge unnecessary features, broad rewrites, premature abstractions, dependency additions, and speculative "nice to have" scope.
7. Once the user chooses or accepts a direction, present the design in sections scaled to the complexity of the task. For complex designs, ask for approval before moving to the next section.
8. Finish with a concise task brief: goal, chosen approach, scope, non-goals, key trade-offs, assumptions, risks, affected areas, and open questions.
9. Hand off to [plan](../plan/SKILL.md) when the user wants implementation steps or a `docs/plan-*.md` artifact.

## Output Format

Default to an in-chat design brief unless the user explicitly asks for a file.

For an in-chat brief, include:

- Goal.
- Chosen approach.
- Alternatives considered.
- Scope and non-goals.
- Constraints and assumptions.
- Risks and validation needs.
- Open questions.
- Recommended next step.

If the user asks for a written artifact, use the [plan file template](../plan/SKILL.md#plan-file-template) and create or update `docs/plan-<short-task-goal>.md` through the plan skill.

## Safety Rules

- Do not write code or edit implementation files while brainstorming.
- Do not skip repo inspection when existing architecture or current behavior matters.
- Do not present a single path as the only option when meaningful alternatives exist.
- Do not ask broad preference questions when a reasonable default can be recommended with trade-offs.
- Do not make the brainstorm output more detailed than the uncertainty justifies.
- Do not create a plan file unless the user asks for a written artifact or moves into planning.
