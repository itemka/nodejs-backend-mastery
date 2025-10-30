<!-- TODO: Re-evaluate scope and approach before starting implementation. -->

# Auth & Identity Service

Build them in one monorepo (`nodejs-backend-mastery`) and reuse shared packages (config/logger/errors/metrics/testing).

- Why: Real apps revolve around identity.
- Covers: OAuth2/OIDC (Google/GitHub), sessions vs JWT, password reset, TOTP/2FA, device & session mgmt, refresh token rotation.
- Stack: Fastify + Passport/oidc-client or custom, Redis for session store.
- Arch: Clean + ports/adapters.
- Stretch: ABAC (attribute-based) + policy engine (Casbin).

## Deployment

- Target: AWS ECS Fargate (+ ALB sticky sessions) or Amazon Cognito as IdP
- AWS: ECR, ECS, ALB, ElastiCache Redis (sessions), Secrets Manager/SSM, CloudWatch; Cognito optional

## CI/CD (GitHub Actions)

- Auth: OIDC to AWS
- Steps (ECS): Docker build → push ECR → `aws ecs update-service`
- Steps (Cognito as IdP): Deploy backing APIs on ECS/Lambda; configure Cognito (CDK)
- Extras: Device/session management, TOTP/2FA, refresh rotation
