# Blue-green deployments

**Category:** deployment-strategies · **Primary app:** — · **Prereqs:** ecs-fargate · **Status:** todo

## Scope

- Two identical environments; traffic switches instantly at the load balancer.
- Fast rollback by flipping back.
- DB migrations must be backward-compatible during the switch.

## Sub-tasks

- [ ] Write a plan for blue-green on ECS using CodeDeploy or weighted target groups.
- [ ] Document the DB migration contract: additive changes only during the overlap.

## Concepts to know

- Cost doubles during the switch window.
- Migrations are the real hard part — schema must satisfy both versions.
- Smoke tests against green before flipping; rollback path tested in advance.

## Interview questions

- Design a blue-green deploy for a stateful API.
- Where does the DB migration story fit?
- Blue-green vs canary — when each?
