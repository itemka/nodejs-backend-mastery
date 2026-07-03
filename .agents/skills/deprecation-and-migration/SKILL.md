---
name: deprecation-and-migration
description: Removing or replacing a system, API, feature, or dependency and migrating its consumers onto the replacement, including feature-flag cleanup and dead-code removal. Use when sunsetting legacy code or deciding whether to maintain or retire existing code.
metadata:
  created: '2026-07-03'
  status: 'baseline'
  portability: 'cross-tool'
  last-reviewed: '2026-07-03'
---

# Deprecation And Migration

## Purpose

Remove or replace a system, API, feature, or dependency safely, and move its consumers onto the replacement before deleting the old path.

## Core Principle

Code is a liability, not an asset — every line carries ongoing maintenance, security, and onboarding cost. Deprecate what no longer earns its keep, but only behind a proven replacement and a concrete migration plan.

## When To Use

- Replacing an existing system, library, or dependency with a new one.
- Removing a feature flag after a rollout is complete.
- Consolidating duplicate or parallel implementations.
- Migrating infrastructure or naming conventions (for example, a legacy namespace to the current one).
- Removing dead or unowned code that consumers still reference.
- Sunsetting a feature, or deciding whether to maintain versus retire existing code.

## Inputs

- The system being deprecated and its known consumers and touchpoints.
- Whether a replacement exists and is production-proven.
- Migration, compatibility, and rollback constraints.
- Feature flags, config, or env toggles involved.
- Tests, metrics, or logs that prove current usage.

## Related Role Specs

- [backend-architect](../../agents/backend-architect.md): load for boundary, interface, or infrastructure migration trade-offs.
- [security-reviewer](../../agents/security-reviewer.md): load when removal touches auth, data exposure, secrets, or stale vulnerable dependencies.
- [tests](../../agents/tests.md): load when behavior parity or characterization coverage of the old path is unclear.

## The Deprecation Decision

Before deprecating, answer:

1. Does this still provide unique value? If yes, maintain it.
2. How many consumers depend on it? Quantify the migration scope.
3. Does a proven replacement exist? Do not deprecate without an alternative.
4. What is the migration cost? Automate it if you can; otherwise weigh manual effort against ongoing maintenance cost.
5. What is the cost of not deprecating? Security debt, complexity, and engineer time.

## Migration Patterns

- **Strangler**: run old and new in parallel and shift traffic incrementally (for example, 0% → canary → 50% → 100% → remove old). Prefer a flag or router you can revert instantly.
- **Adapter**: keep the old interface but delegate to the new implementation underneath, so consumers migrate on their own schedule.

## Workflow

1. Build or confirm the replacement covers all critical use cases and is production-proven.
2. Inventory every consumer and touchpoint using the compiler, tests, search, metrics, and logs.
3. Migrate one consumer at a time: switch to the replacement, verify behavior parity, remove old references, confirm no regression.
4. When a feature flag gated the change, clean it up: confirm it is fully rolled out and stable, replace the conditional with the kept path, delete the dropped branch and its tests, remove the flag from config, state, and types and from the flag service, then update docs.
5. Remove the old system only after verifying zero active usage; delete its code, tests, docs, config, and deprecation notices.
6. Run validation after each meaningful step.

## Output Format

- Deprecation goal and replacement status.
- Consumers migrated and remaining.
- Removal scope (code, tests, docs, config, flags).
- Migration, backfill, and rollback notes.
- Verification evidence and residual risks.

## Safety Rules

- Do not deprecate without a proven replacement and a concrete migration plan.
- Do not remove code, data, or config until metrics, logs, or dependency analysis show zero active usage.
- Churn rule: if you own the thing being deprecated, migrate its consumers or ship a backward-compatible change — do not announce deprecation and leave consumers stranded.
- Do not leave zombie code in limbo — unowned, unmaintained, stale-dependency, or failing-test code with live consumers. Either assign an owner or deprecate it with a plan.
- Reject the usual rationalizations: "it still works" ignores silent security debt; "someone might need it later" is cheaper to rebuild than to carry; "users will migrate on their own" — they will not.

## When Not To Use

- The change preserves external behavior and public contracts — use [refactor](../refactor/SKILL.md).
- It is a data schema or persistence migration with no system or consumer removal — use [data-storage-change](../data-storage-change/SKILL.md).
- No replacement or consumers exist yet — build the replacement first.
