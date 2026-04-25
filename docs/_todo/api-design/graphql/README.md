# GraphQL

**Category:** api-design · **Primary app:** — · **Prereqs:** rest · **Status:** todo

## Scope
- Schema-first vs code-first (e.g. Pothos, Nexus, type-graphql).
- Query / mutation / subscription shapes; resolver chain.
- Dataloader for N+1 mitigation.
- Authorization inside resolvers vs at the edge.
- Trade-offs vs REST: over-fetching, caching, tooling.

## Sub-tasks
- [ ] Build a minimal GraphQL server over one existing Postgres model; add dataloader.
- [ ] Compare REST vs GraphQL request volume for the same client feature; note caching implications.
- [ ] Document authorization story: field-level vs resolver-level.

## Concepts to know
- Persisted queries + APQ to regain HTTP caching.
- Query complexity / depth limiting as the GraphQL equivalent of rate limiting.
- Federation / schema stitching — when multiple GraphQL services exist.
- Subscriptions typically ride WebSockets or SSE.

## Interview questions
- When does GraphQL beat REST? When does it not?
- How do you protect a GraphQL server from expensive queries?
- Explain the N+1 pattern in resolvers and the dataloader fix.
- How would you do authorization on fields vs types?
