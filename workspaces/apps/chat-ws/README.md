# Chat (Realtime)

**Status:** scaffold — planned Phase 5B (realtime systems), app order #5. No
code yet; this is a plan brief. See
[docs/README.md § App Order And Growth Phases](../../../docs/README.md#app-order-and-growth-phases).

- Why: WebSockets at scale.
- Covers: WS rooms, presence, typing indicators, delivery acks, rate-limit &
  flood control, backpressure, horizontal scale with Redis pub/sub.
- Stack: ws/socket.io, Redis, Postgres for history, BullMQ for fan-out.
- Arch: feature-based modules.
- Stretch: secure rejoin with short-lived tokens, message search.

When implementation starts, reuse the existing shared packages
([config](../../packages/config/), [errors](../../packages/errors/)).

## Deployment (planned)

- Target: AWS ECS Fargate + ALB (WebSocket) — alt: API Gateway WebSocket + Lambda
- AWS: ECR, ECS, ALB (sticky), ElastiCache Redis (pub/sub), Route 53, CloudWatch

## CI/CD (GitHub Actions, planned)

- Auth: OIDC to AWS
- Steps (ECS): Docker build → push ECR → `aws ecs update-service`
- Extras: backpressure tests, rate limiting, WS health checks; consider API GW WS for comparison
