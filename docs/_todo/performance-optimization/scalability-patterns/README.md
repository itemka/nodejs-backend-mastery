# Scalability patterns

**Category:** performance-optimization · **Primary app:** [shop-feature-fastify](../../../../workspaces/apps/shop-feature-fastify/) · **Prereqs:** ecs-fargate · **Status:** todo

## Scope

- Horizontal scaling (HPA / ECS service auto-scaling) on CPU, memory, RPS.
- Read replicas for read-heavy workloads.
- Sharding and partitioning.
- Async offload for heavy or slow work.
- Caching layers (see [../../data-storage/caching/redis/](../../data-storage/caching/redis/)).

## Sub-tasks

- [ ] Configure ECS auto-scaling on CPU + ALB request-count-per-target for shop-feature-fastify.
- [ ] Sketch a read-replica strategy for product queries; route reads via env-configured replica URL.
- [ ] Benchmark before/after adding a second ECS task (scale-out) using autocannon.
- [ ] Document the Black Friday game plan: what scales first, second, last.

## Concepts to know

- Stateless services are trivial to scale horizontally; state is the blocker.
- Database is usually the first real bottleneck.
- Auto-scaling takes minutes; plan for steady state + spikes differently.
- Caching + async offload often beat throwing more instances.

## Interview questions

- 10x traffic spike — what breaks first in your stack?
- Sharding vs read replicas vs caching — decision framework.
- Design auto-scaling signals for a spiky workload.
- Database is saturating. What do you do before scaling writes?
