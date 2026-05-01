# Canary deployments

**Category:** deployment-strategies · **Primary app:** — · **Prereqs:** ecs-fargate · **Status:** todo

## Scope

- Gradual traffic shift (1% → 10% → 50% → 100%).
- Automated rollback on SLO breach (error rate, latency).
- Requires good metrics; otherwise canary is blind.

## Sub-tasks

- [ ] Document canary via CodeDeploy weighted target groups or App Mesh.
- [ ] Define SLO-based rollback criteria in this file.

## Concepts to know

- Canary matters only if you have enough traffic to detect problems at 1%.
- Stateful changes (schema, cache format) complicate canary.
- Feature flags are often a better knob for controlled rollout.

## Interview questions

- Design canary rollout with automated rollback.
- What metrics gate promotion?
- How is a canary different from a feature flag?
