# REST principles, versioning, pagination

**Category:** api-design · **Primary app:** [shop-mvc-express](../../../../workspaces/apps/shop-mvc-express/), [shop-feature-fastify](../../../../workspaces/apps/shop-feature-fastify/) · **Prereqs:** express · **Status:** partial

## Scope

- Resource-based URLs, HTTP verbs, status codes.
- Idempotency of verbs; idempotency keys for unsafe writes.
- Versioning strategy (URL `/v1`, header, or query) and trade-offs.
- Pagination: offset vs cursor; when to switch.
- Consistent error envelope; domain error → HTTP mapping via [HttpError](../../../../workspaces/packages/errors/).
- OpenAPI from Zod schemas.

## Sub-tasks

- [ ] Implement product CRUD with Zod validation + 4xx/5xx mapping through HttpError (shop-mvc-express).
- [ ] Add cursor-based pagination for product listing; reject invalid cursors with 400.
- [ ] Pick a versioning strategy and write a one-page ADR in this folder.
- [ ] Generate OpenAPI from Zod via `fastify-type-provider-zod` in shop-feature-fastify; serve `/docs`.
- [ ] Add idempotency-key support on `POST /orders` (link to [microservices/idempotency-retries](../../microservices/idempotency-retries/)).

## Concepts to know

- PUT/DELETE idempotent; POST is not (unless you make it with a key).
- Cursor pagination wins over offset at large N; encodes `(last_sort_key, last_id)`.
- Always return a stable error shape; log a server-side correlation ID.
- 422 vs 400: pick one and apply consistently.
- HATEOAS is rarely worth it for internal APIs.

## Interview questions

- Design the REST surface for orders + payments. Which endpoints are idempotent?
- How do you version a public API without breaking mobile clients?
- Client retries a payment POST — how do you prevent double-charging?
- Offset pagination breaks for 10M-row tables; what do you switch to and why?
- Compare Zod-at-boundaries vs class-validator + DTOs.
