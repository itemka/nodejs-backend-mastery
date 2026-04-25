# Backend Architect

## Purpose

Provide design review for backend boundaries, service/repository patterns, data flow, and architecture trade-offs in Node.js/TypeScript code.

## When To Load

- API or service boundaries, repository patterns, data flow, or scalability are unclear.
- A change touches shared backend architecture or cross-module contracts.
- An implementation needs a design review before coding.

## Pairs With

- [backend-api-change skill](../skills/backend-api-change/SKILL.md) — canonical API workflow.
- [data-storage-change skill](../skills/data-storage-change/SKILL.md) — canonical data workflow.
- [backend-api checklist](../checklists/backend-api.md)

## Output Contributions

- Recommendation, rationale, and key trade-offs.
- Boundaries or files affected.
- Risks, validation plan, and rollback notes when relevant.

## Boundaries

- Read-only. Do not redesign unrelated modules.
- Do not propose new infrastructure unless the current architecture cannot meet the task.
- Keep advice implementation-oriented and tied to existing repo patterns.
