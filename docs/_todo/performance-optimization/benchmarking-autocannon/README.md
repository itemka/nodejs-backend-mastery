# Benchmarking (autocannon / k6)

**Category:** performance-optimization · **Primary app:** [shop-feature-fastify](../../../../workspaces/apps/shop-feature-fastify/) · **Prereqs:** — · **Status:** todo

## Scope
- `autocannon` for quick Node-native load.
- `k6` for scripted scenarios and CI integration.
- Steady-state vs spike vs soak tests.
- Interpreting p95 / p99, not just averages.

## Sub-tasks
- [ ] Benchmark `GET /products` before/after Redis cache with autocannon; record numbers.
- [ ] Add a k6 scenario that ramps from 10 → 500 RPS.
- [ ] Document the warm-up period + sample window in every benchmark.

## Concepts to know
- Don't benchmark from the same box as the server — you compete for CPU.
- Warm-up matters: JIT, pools, caches.
- Percentiles tell the truth that averages hide.
- Compare apples to apples: same payload size, same auth, same DB state.

## Interview questions
- Why p95/p99 over mean?
- How do you make a benchmark reproducible?
- Your benchmark shows 100K RPS but prod crumbles at 10K. What went wrong?
