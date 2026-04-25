# Redis (cache + pub/sub)

**Category:** data-storage/caching · **Primary app:** [shop-feature-fastify](../../../../../workspaces/apps/shop-feature-fastify/), [chat-ws](../../../../../workspaces/apps/chat-ws/) · **Prereqs:** postgresql · **Status:** todo

## Scope
- Cache-aside (lazy loading); write-through; write-behind.
- TTLs + explicit invalidation on writes.
- Pub/sub for fan-out (chat, cache invalidation notifications).
- Redis Streams for at-least-once with replay.
- Sessions and token blacklist use cases.

## Sub-tasks
- [ ] Implement cache-aside for product list + detail in shop-feature-fastify (10-minute TTL).
- [ ] Invalidate keys on product create/update/delete; write a test that proves invalidation.
- [ ] Benchmark product list with/without cache using autocannon; record numbers in [../../../performance-optimization/benchmarking-autocannon/](../../../performance-optimization/benchmarking-autocannon/).
- [ ] Wire Redis pub/sub for cross-instance messages in chat-ws.
- [ ] Use Redis as a token blacklist keyed by JWT `jti` with TTL == access token expiry.

## Concepts to know
- Cache invalidation is the hard problem — do it on writes, not on read.
- Stampede: a hot key expiring triggers many DB reads; mitigate with request coalescing or soft TTL.
- Pub/sub is at-most-once; Streams are at-least-once with consumer groups.
- Eviction policy matters when memory is tight (`allkeys-lru`, `volatile-lru`, etc.).
- ElastiCache Redis cluster: single point of failure without Multi-AZ.

## Interview questions
- Explain cache-aside with pseudo-code. Where does invalidation live?
- You have a hot product page; describe caching end-to-end including invalidation.
- Redis pub/sub lost a message. What fixed the design?
- When would you use Streams over pub/sub?
- Cache stampede on expiry — what do you do?
