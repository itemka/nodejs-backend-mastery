---
name: backend-api-change
description: Backend API route and contract changes for HTTP handlers, controllers, services, middleware, request/response schemas, validation, status codes, and API errors. Use when adding or changing backend API behavior.
metadata:
  created: '2026-04-25'
  status: 'baseline'
  portability: 'cross-tool'
  last-reviewed: '2026-04-26'
---

# Backend API Change

## Purpose

Implement backend API changes while preserving contracts, validation, layering, and tests.

## When To Use

- Adding or changing HTTP routes, controllers, handlers, services, middleware, or API responses.
- Changing request validation, status codes, auth behavior, or error mapping.
- Updating examples or docs for backend behavior.

## Inputs

- Desired API behavior.
- Existing route/controller/service/repository files.
- Request and response examples, if available.
- Test expectations and docs to update.

## Related Role Specs

- [backend-architect](../../agents/backend-architect.md): load for API boundary, service boundary, repository pattern, or cross-module design review.
- [security-reviewer](../../agents/security-reviewer.md): load when auth, authorization, validation, data exposure, rate limits, uploads, webhooks, logs, or dependencies are in scope.
- [tests](../../agents/tests.md): load when test strategy or coverage level is unclear.

## Workflow

1. Find route, controller, service, and repository boundaries.
2. Confirm the request and response contract, including status codes.
3. Validate input at the boundary using the existing schema style.
4. Use the existing error-handling and logging style.
5. Keep business logic out of route handlers where possible.
6. Add or update unit/integration tests for normal and edge cases.
7. Update docs, examples, or API notes when behavior changes.
8. Report status codes, edge cases, and validation performed.

## Output Format

- Changed API surface.
- Files changed.
- Status codes and error cases.
- Tests and validation run.
- Remaining risks or follow-ups.

## Safety Rules

- Do not silently change public response shapes.
- Do not leak internal errors or sensitive fields.
- Do not bypass auth, validation, rate limits, or request-size controls.

## When Not To Use

- The change is internal-only with no API behavior impact.
- The task is only data migration, test cleanup, or documentation.
