---
name: data-storage-change
description: Data storage and persistence changes for schemas, migrations, indexes, queries, caching, repositories, transactions, and data access. Use when changing how data is stored or retrieved.
metadata:
  created: '2026-04-25'
  status: 'baseline'
  portability: 'cross-tool'
  last-reviewed: '2026-05-05'
---

# Data Storage Change

## Purpose

Change data storage safely while accounting for correctness, consistency, performance, and rollback.

## When To Use

- Adding or changing schemas, migrations, indexes, repositories, queries, transactions, or cache behavior.
- Introducing new persistence access patterns.
- Modifying data consistency or rollback behavior.

## Inputs

- Existing schema, query, repository, or cache code.
- Expected read/write patterns and data volume.
- Migration or compatibility constraints.
- Tests and production rollout constraints.

## Related Role Specs

- [backend-architect](../../agents/backend-architect.md): load for repository boundaries, data flow, consistency, scalability, or migration trade-offs.
- [security-reviewer](../../agents/security-reviewer.md): load when storage changes affect data exposure, access control, secrets, logs, or production data risk.
- [tests](../../agents/tests.md): load when migration, repository, transaction, or cache behavior needs a focused test strategy.

## Workflow

1. Identify access patterns and consistency needs.
2. Inspect the existing data layer and repository boundaries.
3. Choose the smallest schema, query, cache, or repository change.
4. Consider transactions, isolation, retries, and partial failure.
5. Consider indexes, query plans, cache keys, invalidation, and performance.
6. Add tests for normal behavior, edge cases, and negative paths.
7. Document migration, rollout, rollback, or backfill notes when relevant.

## Output Format

- Data model or access change.
- Consistency and transaction notes.
- Performance and index notes.
- Migration or rollback notes.
- Tests and validation run.

## Safety Rules

- Do not run destructive migrations without explicit approval.
- Do not remove or rewrite data without a rollback plan.
- Do not expose storage-specific types through public API contracts unless already established.

## When Not To Use

- The change does not touch persistence, cache, or data access.
- The task is only API routing, UI, or docs.
