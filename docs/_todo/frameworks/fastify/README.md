# Fastify plugins & type providers

**Category:** frameworks · **Primary app:** [shop-feature-fastify](../../../../workspaces/apps/shop-feature-fastify/) · **Prereqs:** express · **Status:** todo

## Scope

- Fastify plugin system: encapsulation, lifecycle hooks, `fastify.register`.
- Type providers (Zod or TypeBox) for compile-time + runtime validation.
- Per-feature plugins exporting their own route + schema + service.
- Built-in JSON schema compilation for performance.

## Sub-tasks

- [ ] Scaffold the app using [@workspaces/packages/config](../../../../workspaces/packages/config/) and the esbuild workspace onResolve plugin.
- [ ] Wire `fastify-type-provider-zod` and generate OpenAPI from route schemas.
- [ ] Create `src/modules/{products,users,orders,cart}`; each a Fastify plugin.
- [ ] Add `@fastify/helmet`, `@fastify/cors`, `@fastify/rate-limit`.
- [ ] Integrate Pino with request IDs; propagate to services via `onRequest` hook.

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
