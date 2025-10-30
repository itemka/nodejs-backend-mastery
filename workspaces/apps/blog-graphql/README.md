<!-- TODO: Re-evaluate scope and approach before starting implementation. -->

# Blog/Content with Search (GraphQL)

Build them in one monorepo (`nodejs-backend-mastery`) and reuse shared packages (config/logger/errors/metrics/testing).

- Why: Non-trivial querying and schema evolution.
- Covers: GraphQL schema/resolvers, N+1 (dataloaders), full-text search (Meilisearch/Elastic), soft deletes, drafts/publishing workflow.
- Stack: Apollo GraphQL, Postgres, Meilisearch/Elastic, OpenTelemetry traces.
- Arch: Feature-based or Clean.
- Stretch: Federation/subgraphs or code-first schema + codegen.

## Deployment

- Target: AWS App Runner (container serverless)
- AWS: App Runner, ECR (image), RDS Postgres, CloudWatch

## CI/CD (GitHub Actions)

- Auth: OIDC to AWS
- Steps: Docker build → push ECR → `aws apprunner create-service`/`update-service` (or via CDK)
- Extras: Persisted queries, response caching; compare latency vs ECS
