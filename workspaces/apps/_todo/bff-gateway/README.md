# BFF Gateway (for Web & Mobile)

**Status:** deferred brief — not in the committed app order. Gateway/BFF
learning fits a later microservices phase; the circuit-breaker/timeout scope
lands earlier in `orders-event-driven` (Phase 4). Revisit only when an
aggregation layer has a concrete consumer.

- Why: real teams need aggregation layers.
- Covers: tRPC/OpenAPI aggregation, response shaping, caching, circuit
  breaker/timeouts, fallback, canaries.
- Stack: Fastify gateway, tRPC or OpenAPI client codegen, Redis.
- Arch: feature-based; adapters for upstream services.
- Stretch: per-client rate limits, AB testing/feature flags.

## Deployment (sketch)

- Target: AWS Lambda + API Gateway (edge cache via CloudFront)
- AWS: Lambda, API Gateway, CloudFront, Redis (optional)
