<!-- TODO: Re-evaluate scope and approach before starting implementation. -->

# Chat (Realtime)

Build them in one monorepo (`nodejs-backend-mastery`) and reuse shared packages (config/logger/errors/metrics/testing).

- Why: WebSockets at scale.
- Covers: WS rooms, presence, typing indicators, delivery acks, rate-limit & flood control, backpressure, horizontal scale with Redis pub/sub.
- Stack: ws/socket.io, Redis, Postgres for history, BullMQ for fan-out.
- Arch: Feature-based modules.
- Stretch: Secure rejoin with short-lived tokens, message search.

## Deployment

- Target: AWS ECS Fargate + ALB (WebSocket) — alt: API Gateway WebSocket + Lambda
- AWS: ECR, ECS, ALB (sticky), ElastiCache Redis (pub/sub), Route 53, CloudWatch

## CI/CD (GitHub Actions)

- Auth: OIDC to AWS
- Steps (ECS): Docker build → push ECR → `aws ecs update-service`
- Extras: Backpressure tests, rate limiting, WS health checks; consider API GW WS for comparison
