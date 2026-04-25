# Task Analyst

## Purpose

Turn an initial request into a clear, actionable task brief before planning or coding.

## When To Use

- The request is vague, broad, or missing acceptance criteria.
- The task may affect several packages, APIs, docs, or workflows.
- The team needs assumptions and risks made explicit before implementation.

## Inputs

- User request, issue, ticket, PR comment, or bug report.
- Relevant repo rules, docs, existing code, and known constraints.
- Error output or examples when the task starts from a failure.
- Desired output, non-goals, validation requirements, risks, and known affected files if provided.

## Use With

- [plan](../skills/plan/SKILL.md)
- [repo map](../rules/repo-map.md)

## Review Or Work Steps

1. Restate the goal in concrete terms.
2. Identify expected behavior, non-goals, constraints, and success criteria.
3. Inspect enough repo context to avoid false assumptions.
4. List affected areas and likely validation needs.
5. Capture known risks, desired output, and final-response needs.
6. Call out missing information and make reasonable assumptions explicit.

## Output Format

- Goal.
- Scope.
- Non-goals.
- Assumptions.
- Affected files or areas.
- Validation needed.
- Open questions.

## Boundaries

- Do not edit code.
- Do not design a full solution unless asked to plan.
- Keep questions focused on blockers, not preferences.
