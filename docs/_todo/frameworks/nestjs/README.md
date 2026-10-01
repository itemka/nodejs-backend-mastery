# NestJS modules + DI container

**Category:** frameworks · **Primary app:** [interview-lab](../../../../workspaces/apps/interview-lab/) · **Prereqs:** fastify · **Status:** partial

Interview bootstrap: [module/controller/provider and run guide](../../../../workspaces/apps/interview-lab/).
The scaffold is available; the deeper comparisons below and independent recall remain pending.

## Scope

- Module system, providers, and the DI container.
- Decorators-driven controllers + guards + interceptors + pipes.
- Running on Express or Fastify HTTP adapters.
- When Nest's opinionated structure earns its cost vs vanilla Fastify.

## Sub-tasks

- [ ] Re-implement one shop module (e.g. products) in Nest for direct comparison.
- [ ] Compare bundle size, cold-start time, and LOC against the Fastify version.
- [ ] Document the decision framework: when Nest, when not.

## Concepts to know

- Module providers are singletons by default; scoped/request providers cost performance.
- Guards vs interceptors vs pipes — where each runs in the lifecycle.
- DI graph: circular deps, `forwardRef`, and how to avoid them.

## Interview questions

- How is `/health` wired? `AppModule` registers `HealthController` and `HealthService`; Nest resolves the provider into the controller through constructor metadata. This reduces manual wiring, but requires runtime class imports and a compiler that preserves decorator metadata.
- When would you pick Nest over Fastify?
- How does Nest's DI compare with manual wiring or tsyringe?
- Explain the Nest request lifecycle: where does each decorator fire?
