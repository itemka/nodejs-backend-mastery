# Plan File Template

Copy this structure when creating or updating `docs/plan-<short-task-goal>.md`.
Naming, timestamp, and file-vs-chat rules live in
[SKILL.md](./SKILL.md#plan-artifact-policy).

```md
# Plan: <short task goal>

## Goal

**Current:** [Concrete current behavior or state, if known]

**Required:** [What needs to change or be decided]

## Scope And Non-Goals

- In scope:
- Not included:
- Decisions and trade-offs:

## Context And Assumptions

- Checked:
- Assumptions:
- Open questions:

## Risks

- Risk:

## Affected Areas

- Area:

## Implementation Steps

<!--
Each step must be one verifiable action. Use area headings only when the plan
spans multiple areas, such as Backend, Frontend, Data, CI, or Docs. Keep step
numbering continuous across headings, and omit unused headings.

Mark a step [P] only when it can run in parallel with other [P] steps without
shared-file conflicts or dependency ordering. Add "Depends on: Step N" only when
an earlier step must finish first.
-->

### Area

- [ ] Step 1 - <imperative action>
  - Files: path/a, path/b
  - Depends on: Step N
  - Validate: <command or manual check> -> <expected evidence>
  - Done when: <observable acceptance condition>

## Validation

- Covers:
- Run:
- Expected evidence:
- Timing:

## Rollback Or Migration Notes

- Notes:

## Status

- State: draft
- Current step: Step 1
- Created: YYYY-MM-DDTHH:mm+HH:MM
- Last updated: YYYY-MM-DDTHH:mm+HH:MM
```
