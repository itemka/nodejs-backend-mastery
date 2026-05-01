# Metrics (Prometheus)

**Category:** observability · **Primary app:** [shop-feature-fastify](../../../../workspaces/apps/shop-feature-fastify/) · **Prereqs:** logging · **Status:** todo

## Scope

- RED (Rate, Errors, Duration) for services; USE (Utilization, Saturation, Errors) for resources.
- Counter vs Gauge vs Histogram vs Summary.
- Cardinality: every label multiplies series count.
- `prom-client` library for Node; `/metrics` scrape endpoint.
- SLIs / SLOs / error budgets.

## Sub-tasks

- [ ] Add `prom-client` to shop-feature-fastify; expose `/metrics`.
- [ ] Emit `http_request_duration_seconds` histogram, labeled `route`, `method`, `status`.
- [ ] Emit a `cache_hit_ratio` gauge for the Redis cache-aside layer.
- [ ] Set one SLO per app (e.g. 99.5% success on /products, p95 < 200ms); document in this file.

## Concepts to know

- Histograms let you compute percentiles; summaries pre-compute but can't aggregate.
- High-cardinality labels (user_id, URL path) blow up the series count.
- Alert on SLO burn, not on raw values.
- Exemplars tie a histogram bucket to a trace ID — debug gold.

## Interview questions

- RED vs USE — when each?
- Why do high-cardinality labels kill Prometheus?
- Pick three metrics for a REST service and justify them.
- What's an error budget and how do you spend it?
