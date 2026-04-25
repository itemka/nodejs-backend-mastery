# Scheduled / cron jobs

**Category:** async-processing · **Primary app:** [serverless-toolkit](../../../../workspaces/apps/serverless-toolkit/) · **Prereqs:** — · **Status:** todo

## Scope
- OS cron / systemd timers — single-host only.
- Node schedulers (`node-cron`, `@nestjs/schedule`) — single-instance only unless coordinated.
- Distributed: EventBridge rules, BullMQ repeatable jobs, DB-backed locks.
- Idempotency for re-runs; clock skew considerations.

## Sub-tasks
- [ ] Implement an EventBridge rule → Lambda daily cleanup in serverless-toolkit.
- [ ] Make the job idempotent so re-runs on the same day are safe.
- [ ] Document how you'd do the same thing in an ECS environment (BullMQ vs leader election).

## Concepts to know
- Multiple app instances running node-cron will all fire — use a distributed lock or external scheduler.
- EventBridge is at-least-once; assume duplicates can fire.
- Timezones: default UTC; surface explicitly in config.

## Interview questions
- You need a daily report across a fleet of ECS tasks. How do you ensure it runs exactly once?
- Compare EventBridge schedules vs BullMQ repeatable jobs.
- Job fires twice due to at-least-once delivery — design so that's safe.
