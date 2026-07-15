# Reliability & resilience patterns

**Category:** reliability-resilience · **Primary app:** [orders-event-driven](../../../workspaces/apps/orders-event-driven/), [shop-mvc-express](../../../workspaces/apps/shop-mvc-express/) · **Prereqs:** event-driven · **Status:** todo

## Scope

- Timeouts on every outbound call (connect + read) and per-request deadline budgets.
- Retries with exponential backoff + jitter; retry budgets; idempotent operations only.
- Circuit breakers: closed/open/half-open, failure-rate thresholds, recovery probes.
- Load shedding and backpressure: bounded queues, reject early with 429/503 + `Retry-After`.
- Bulkheads: isolated pools/limits per dependency.
- Graceful degradation: fallbacks, cached responses, kill switches.

## Sub-tasks

- [ ] Add connect/read timeouts to the shop→auth HTTP call; surface a typed 504 via the shared HttpError mapping. (Phase 4)
- [ ] Wrap the shop→auth call in a circuit breaker; test closed→open→half-open transitions.
- [ ] Add retries with exponential backoff + jitter to one idempotent outbound call; cap total attempt time.
- [ ] Bound the BullMQ queue in orders-event-driven and shed load on saturation with an explicit 503.
- [ ] Write a short note: retry budget vs per-request retry cap, linking the enforcing code.

## Concepts to know

- A retry without a timeout is a resource leak; a timeout without a deadline budget still cascades.
- Retry only idempotent operations; pair everything else with idempotency keys.
- Circuit breakers protect the caller; load shedding protects the callee — you usually need both.
- Jitter exists to prevent synchronized thundering herds after recovery.
- An untested fallback fails exactly when you need it; test degradation paths like features.

## Interview questions

- A downstream service slows to 5s p99 and your callers pile up — walk through the failure and each mitigation layer.
- When do retries make an outage worse, and what limits prevent that?
- Explain circuit-breaker states and how you would pick thresholds in production.
- How do you shed load without dropping high-value requests?

## Evidence <!-- required before status becomes done -->

- **Code:** None yet — lands with Phase 4 in `orders-event-driven` and the shop→auth call.
- **Tests:** None yet — add links with the implementing code.
- **Interview answer:** None yet — answer one question above with a code link.
