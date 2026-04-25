# Secret management

**Category:** auth-security · **Primary app:** [shop-feature-fastify](../../../../workspaces/apps/shop-feature-fastify/) · **Prereqs:** aws · **Status:** todo

## Scope
- AWS Secrets Manager vs SSM Parameter Store.
- IAM-based access with least privilege; OIDC for CI/CD instead of static keys.
- Rotation strategies (automatic vs manual).
- Local dev vs prod: `.env` local only, never committed.

## Sub-tasks
- [ ] Store DB + Redis credentials for shop-feature-fastify in Secrets Manager.
- [ ] Inject as environment variables into the ECS task definition via `secrets:` block.
- [ ] Write a minimal IAM policy allowing only `GetSecretValue` for the app's prefix.
- [ ] Migrate GitHub Actions to OIDC → IAM role (no long-lived keys).
- [ ] Document the rotation plan (automatic for RDS, manual for API keys).

## Concepts to know
- SSM Parameter Store is cheaper; Secrets Manager has built-in rotation for RDS/Redshift.
- Never log secret values, even at debug.
- Git history keeps secrets forever — rotate if ever committed.
- Container env vars are readable by any process in the container; sensitive values can also be pulled on demand.

## Interview questions
- How do you manage secrets for a containerized app on ECS?
- How does a GitHub Action authenticate to AWS without static keys?
- A secret leaked on GitHub — first 10 minutes?
- Secrets Manager vs SSM — decision framework.
