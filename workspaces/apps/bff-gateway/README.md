<!-- TODO: Re-evaluate scope and approach before starting implementation. -->

# BFF Gateway (for Web & Mobile)

Build them in one monorepo (`nodejs-backend-mastery`) and reuse shared packages (config/logger/errors/metrics/testing).

- Why: Real teams need aggregation layers.
- Covers: tRPC/OpenAPI aggregation, response shaping, caching, circuit breaker/timeouts, fallback, canaries.
- Stack: Fastify Gateway, tRPC or OpenAPI client codegen, Redis.
- Arch: Feature-based; adapters for upstream services.
- Stretch: Per-client rate limits, AB testing/feature flags.

## Deployment

- Target: AWS Lambda + API Gateway (edge cache via CloudFront)
- AWS: Lambda, API Gateway, CloudFront, Redis (optional)

## CI/CD (GitHub Actions)

- Auth: OIDC to AWS
- Steps: `cdk deploy` for Lambda + API GW; set up CloudFront behaviors
- Extras: Timeouts, circuit breakers, per-client rate limits
