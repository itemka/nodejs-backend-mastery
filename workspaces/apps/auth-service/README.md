# Auth & Identity Service

**Status:** scaffold — planned Phase 3 (auth/security), app order #2. No code
yet; this is a plan brief. See
[docs/README.md § App Order And Growth Phases](../../../docs/README.md#app-order-and-growth-phases).

- Why: real apps revolve around identity.
- Covers: OAuth2/OIDC (Google/GitHub), sessions vs JWT, password reset,
  TOTP/2FA, device & session management, refresh token rotation, RBAC consumed
  by the shop app, OpenAPI spec from day one.
- Stack: Fastify + Passport/oidc-client or custom, Redis for session store.
- Arch: hexagonal (ports/adapters).
- Stretch: ABAC (attribute-based) + policy engine (Casbin).

When implementation starts, reuse the existing shared packages
([config](../../packages/config/), [errors](../../packages/errors/)); do the
shared-package rename to `@workspaces/<name>` before this app becomes their
next consumer.

## Deployment (planned)

- Target: AWS ECS Fargate (+ ALB sticky sessions) or Amazon Cognito as IdP
- AWS: ECR, ECS, ALB, ElastiCache Redis (sessions), Secrets Manager/SSM, CloudWatch; Cognito optional

## CI/CD (GitHub Actions, planned)

- Auth: OIDC to AWS
- Steps (ECS): Docker build → push ECR → `aws ecs update-service`
- Steps (Cognito as IdP): deploy backing APIs on ECS/Lambda; configure Cognito (CDK)
- Extras: device/session management, TOTP/2FA, refresh rotation
