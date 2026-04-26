# Feature flags

**Category:** deployment-strategies · **Primary app:** — · **Prereqs:** — · **Status:** todo

## Scope
- Release flags (ship dark, flip on), experiment flags (A/B), ops flags (kill switch).
- Flag storage: config file, LaunchDarkly, Unleash, GrowthBook, Flagsmith.
- Flag lifecycle: create → enable → clean up. Tech debt accumulates if you skip the last step.

## Sub-tasks
- [ ] Pick a flag store (self-hosted or SaaS) and wire one flag into shop-feature-fastify.
- [ ] Document the cleanup rule: every flag has a removal date or ticket.

## Concepts to know
- Flags are conditional complexity in production — keep the count low.
- Evaluating flags should be fast and cached; don't block requests on the flag service.
- Flags are not a security boundary — never flag off sensitive checks.

## Interview questions
- Design a feature-flag system. What does it need for reliability?
- How do you prevent flag rot?
- When does a flag go from "useful" to "tech debt"?
