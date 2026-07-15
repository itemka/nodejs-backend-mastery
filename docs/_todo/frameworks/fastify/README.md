# Fastify plugins & type providers

**Category:** frameworks · **Primary app:** [auth-service](../../../../workspaces/apps/auth-service/), [shop-feature-fastify](../../../../workspaces/apps/shop-feature-fastify/) · **Prereqs:** express · **Status:** todo

## Scope

- Fastify plugin system: encapsulation, lifecycle hooks, `fastify.register`.
- Type providers (Zod or TypeBox) for compile-time + runtime validation.
- Per-feature plugins exporting their own route + schema + service.
- Built-in JSON schema compilation for performance.

## Sub-tasks

- [ ] Scaffold auth-service with Fastify, the shared [config](../../../../workspaces/packages/config/) and [errors](../../../../workspaces/packages/errors/) packages, and the esbuild workspace `onResolve` plugin.
- [ ] Wire `fastify-type-provider-zod` into auth-service route schemas.
- [ ] Generate the auth-service OpenAPI contract from its route schemas.
- [ ] Register auth-service HTTP adapters as encapsulated Fastify plugins around its hexagonal application ports.
- [ ] Add `@fastify/helmet`, `@fastify/cors`, and `@fastify/rate-limit` to auth-service.
- [ ] Integrate Pino request IDs into auth-service and propagate its request logger through `onRequest`.
- [ ] Scaffold shop-feature-fastify with Fastify, the shared config/errors packages, and the esbuild workspace `onResolve` plugin.
- [ ] Create `src/modules/{products,users,orders,cart}` in shop-feature-fastify, with each module registered as a Fastify plugin.
- [ ] Add `@fastify/helmet`, `@fastify/cors`, and `@fastify/rate-limit` to shop-feature-fastify.
- [ ] Integrate Pino request IDs into shop-feature-fastify and propagate its request logger through `onRequest`.

## Concepts to know

- Plugin encapsulation: child plugin decorators do not leak to parent.
- Lifecycle hooks: `onRequest`, `preHandler`, `preSerialization`, `onSend`, `onResponse`, `onError`.
- Performance: Fastify's JSON schema compile outpaces Express + manual validation.
- Graceful shutdown via `fastify.close()`.

## Interview questions

- Why did you pick Fastify over Express for v2 of the shop?
- Explain Fastify plugin encapsulation and when it bites you.
- How does type-provider Zod differ from validating inside controllers?
- Compare Fastify hooks with Express middleware — what do hooks give you?
