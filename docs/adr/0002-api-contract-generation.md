# ADR-0002: API Contract Generation

- **Status:** Accepted
- **Decision date:** 2026-07-22
- **Recorded:** 2026-07-22

## Context

`shop-mvc-express` already validates product input with a boundary
[Zod schema](../../workspaces/apps/shop-mvc-express/src/schemas/product.schema.ts). The app needed
an OpenAPI contract for documentation, contract tests, and consumers without creating a second
request-schema source.

This is a retrospective record of the decision implemented in commit `550bb2f`; `Proposed` means
the record awaits human confirmation, not that the published contract is unimplemented.

## Decision

Generate OpenAPI 3.1 from the Zod schemas with `zod-openapi`. Keep the
[document builder](../../workspaces/apps/shop-mvc-express/src/openapi/document.ts) as the contract
source, commit the generated `docs/openapi.json`, serve it at `/openapi.json`, and expose Swagger
UI at `/docs/` outside production.

## Consequences

- Boundary schemas remain the source for runtime validation and OpenAPI schema metadata, reducing
  contract drift.
- The generated JSON is tool-owned and must never be edited by hand.
- Changes to the contract require regeneration, linting, drift checks, and contract-test updates.
- Contract generation is coupled to compatibility among Zod 4, `zod-openapi`, and the document
  builder, so dependency changes require verification.

## Alternatives

- **A hand-written spec-first contract:** not selected because it would repeat the request shape
  already enforced by Zod and create another source that could drift.
- **`swagger-jsdoc` annotations:** not selected because comment annotations would separate the
  contract from the executable boundary schemas and could drift independently.
- **A plain hand-assembled OpenAPI object:** not selected because independently repeating schemas
  would add manual wiring and lose the schema reuse provided by `zod-openapi`.

## Compliance

- Generate with `pnpm --filter shop-mvc-express openapi:generate`; the
  [generator](../../workspaces/apps/shop-mvc-express/scripts/generate-openapi.ts) formats the
  artifact and its check mode rejects missing or stale output.
- `pnpm --filter shop-mvc-express openapi:check` also runs Redocly lint, and the
  [main CI workflow](../../.github/workflows/ci.yml) invokes it for changed workspaces.
- The [OpenAPI tests](../../workspaces/apps/shop-mvc-express/tests/openapi.test.ts) verify the served
  contract and Swagger UI, while the
  [product contract tests](../../workspaces/apps/shop-mvc-express/tests/api/products.test.ts)
  compare implemented responses with the document.
- Follow the [generated-files rule](../../.agents/rules/change-discipline.md): change schemas or
  the document builder, then regenerate `docs/openapi.json`.
