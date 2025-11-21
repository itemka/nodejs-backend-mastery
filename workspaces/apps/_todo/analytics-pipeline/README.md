<!-- TODO: Re-evaluate scope and approach before starting implementation. -->

# Analytics & Reporting Pipeline

Build them in one monorepo (`nodejs-backend-mastery`) and reuse shared packages (config/logger/errors/metrics/testing).

- Why: OLTP→OLAP patterns.
- Covers: CDC or scheduled ETL, ClickHouse/BigQuery, materialized views, pre-aggregations, report API, cache warming, access control for analytics.
- Stack: Debezium (optional), Airflow/Temporal or simple workers, ClickHouse, Superset/Grafana dashboards.
- Arch: Separate analytics service.
- Stretch: SLOs for freshness & query latency, cost guardrails.

## Deployment

- Target: DMS/CDC → S3 → Athena/Glue (or ClickHouse on ECS/EC2)
- AWS: DMS, S3, Glue, Athena, Lake Formation; or ECS + ClickHouse

## CI/CD (GitHub Actions)

- Auth: OIDC to AWS
- Steps: `cdk deploy` DMS tasks, Glue crawlers, Athena setup; or ECS service for ClickHouse
- Extras: Freshness SLOs, cost guardrails, partitioning and lifecycle policies
