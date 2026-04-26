# Tracing (OpenTelemetry)

**Category:** observability · **Primary app:** [shop-feature-fastify](../../../../workspaces/apps/shop-feature-fastify/) · **Prereqs:** logging · **Status:** todo

## Scope
- OTel concepts: spans, context propagation, resources, exporters.
- Auto-instrumentation for HTTP, PG, Redis.
- Manual spans around custom work (caches, queues).
- W3C Trace Context headers for cross-service correlation.
- Sampling strategies.

## Sub-tasks
- [ ] Wire `@opentelemetry/sdk-node` with auto-instrumentations in shop-feature-fastify.
- [ ] Export to a local Jaeger in docker-compose.
- [ ] Add a manual span around the cache-aside block with cache-hit attribute.
- [ ] Document the sampling rate and why.

## Concepts to know
- Tail-based sampling keeps slow/errored traces; head-based is cheaper but random.
- Never log full span attributes at high volume.
- Trace IDs are worth more than logs when debugging latency across services.
- Exemplars (metric ↔ trace link) close the three-pillar loop.

## Interview questions
- Explain a trace, a span, and baggage.
- How do traces propagate across services? What headers?
- Head vs tail sampling — when each?
- Your P95 is 500ms for one endpoint. Walk through using a trace to find the cause.
- Production API latency spiked. Walk through metrics, logs, traces, DB, cache, and external dependency checks.
