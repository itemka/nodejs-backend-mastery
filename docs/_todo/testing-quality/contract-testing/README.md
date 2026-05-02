# Contract testing (Pact)

**Category:** testing-quality · **Primary app:** [shop-feature-fastify](../../../../workspaces/apps/shop-feature-fastify/) ↔ [auth-service](../../../../workspaces/apps/auth-service/) · **Prereqs:** integration-testing · **Status:** todo

## Scope

- Consumer-driven contracts (Pact).
- Provider verification against captured contracts.
- Broker: Pactflow / self-hosted.
- When to skip: single-team monorepo often doesn't need it.

## Sub-tasks

- [ ] Set up a Pact contract between shop-feature-fastify (consumer) and auth-service (provider).
- [ ] Run consumer tests in PR; run provider verification before auth-service deploys.
- [ ] Document the rollout story: break-glass when contracts intentionally change.

## Concepts to know

- Contracts are specs for what the consumer needs, not what the provider offers.
- Provider changes that break the contract fail CI before deploy.
- Contracts rot without enforcement — tie them to deploy.

## Interview questions

- When does contract testing earn its keep?
- Explain consumer-driven contracts vs schema-first APIs.
- A contract fails after a provider deploy. Walk me through resolving.
