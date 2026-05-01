# Input validation

**Category:** auth-security · **Primary app:** [shop-mvc-express](../../../../workspaces/apps/shop-mvc-express/) · **Prereqs:** express · **Status:** partial

## Scope

- Zod schemas at every external boundary (HTTP, queue messages, webhooks).
- Parse, don't validate — reject unknown keys, coerce types.
- Central error shape for validation failures (422 with field list).

## Sub-tasks

- [ ] Add Zod parsing to every route handler in shop-mvc-express; no `any` leakage.
- [ ] Standardize validation error payload: `{ code, field, message }[]`.
- [ ] Share input schemas with the client when a client exists.
- [ ] Document why we don't re-validate inside services.

## Concepts to know

- Validate at boundaries; trust internal code.
- `.strict()` rejects unknown keys; `.passthrough()` keeps them — choose per-endpoint.
- Schema + TypeScript infer = single source of truth.
- Over-sanitization (stripping HTML etc.) is for output, not input.

## Interview questions

- Where do you validate input and why there?
- Why parse with Zod instead of a library like Joi? What are the trade-offs?
- How do you surface validation errors to a client without leaking internals?
