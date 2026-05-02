# API gateway / BFF

**Category:** microservices · **Primary app:** [bff-gateway](../../../../workspaces/apps/bff-gateway/) · **Prereqs:** rest · **Status:** todo

## Scope

- API gateway responsibilities: routing, auth offload, rate limiting, request transformation.
- BFF (Backend For Frontend) vs generic gateway.
- Request aggregation / composition.
- Where auth happens: edge vs service.

## Sub-tasks

- [ ] Build a minimal Fastify gateway that routes `/auth/*` → auth-service, `/shop/*` → shop-feature-fastify.
- [ ] Verify the access JWT once at the gateway; propagate claims to downstreams.
- [ ] Implement one aggregation endpoint that composes data from both services.
- [ ] Apply global rate limits at the gateway; per-route caps on sensitive endpoints.

## Concepts to know

- Don't put business logic in the gateway — that's how it becomes a monolith again.
- BFF per client type (web / mobile) keeps clients from dictating backend contracts.
- Gateway adds latency — measure it.
- Retries at the gateway can amplify backend failures.

## Interview questions

- When do you need a gateway? When a plain load balancer?
- BFF vs generic gateway — when do you split?
- How do you avoid the gateway becoming a new monolith?
- Does auth belong at the edge or inside each service?
- Plan a strangler migration from `shop-mvc-express` to services. What moves first, and what owns the data?
