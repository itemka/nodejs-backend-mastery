# MVC / layered + feature-based

**Category:** architecture-patterns · **Primary app:** [shop-mvc-express](../../../../workspaces/apps/shop-mvc-express/), [shop-feature-fastify](../../../../workspaces/apps/shop-feature-fastify/) · **Prereqs:** express · **Status:** partial

## Scope
- Classic MVC / layered: controllers → services → repositories → models.
- Feature-based (vertical slice): a folder per feature, each self-contained.
- Repository pattern: services depend on interfaces, not DB clients.
- Where to put cross-cutting concerns (logging, auth, tracing) in each layout.

## Sub-tasks
- [ ] Keep shop-mvc-express on layered MVC; document the final module boundaries.
- [ ] In shop-feature-fastify, create `src/modules/{products,users,orders,cart}` as Fastify plugins.
- [ ] Add a `Repository` interface per module; inject implementation in the plugin root.
- [ ] Write a short ADR in this file comparing MVC vs feature-based for the shop.

## Concepts to know
- MVC can degrade into "fat controllers" as features grow.
- Feature-based isolates change surface; easier to extract to a microservice later.
- Repository pattern costs indirection — only worth it when you actually swap or mock the store.
- DI can be manual (constructor args) or container-based; both fine at this scale.

## Interview questions
- Compare MVC vs feature-based. Why did you pick feature-based for v2?
- Repository pattern: what does it cost, what does it buy?
- Where do cross-cutting concerns (logging, auth, tracing) live in your layout?
- Walk through a request from HTTP to DB and back in your Fastify app.
