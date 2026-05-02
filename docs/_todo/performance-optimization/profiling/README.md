# Profiling

**Category:** performance-optimization · **Primary app:** [shop-feature-fastify](../../../../workspaces/apps/shop-feature-fastify/) · **Prereqs:** event-loop · **Status:** todo

## Scope

- V8 profiler (`--prof`, `--cpu-prof`).
- `clinic.js` toolkit: doctor, flame, bubbleprof.
- Inspector + Chrome DevTools CPU profile.
- Flame graphs — reading them.

## Sub-tasks

- [ ] Profile one hot path in shop-feature-fastify with `clinic doctor`.
- [ ] Capture a flame graph of the product list endpoint under load.
- [ ] Record a before/after in this file with the root cause and fix.

## Concepts to know

- Profile in a prod-like env — dev overhead can dominate signal.
- Self-time vs total-time — know which column to read for what.
- Tickets for the event loop vs I/O wait look very different in flames.

## Interview questions

- Walk me through finding a CPU bottleneck with `clinic`.
- How do you profile a service you can't run locally?
- How do you confirm a fix is actually a fix?
