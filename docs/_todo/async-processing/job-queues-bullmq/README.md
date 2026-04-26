# Job queues (BullMQ)

**Category:** async-processing · **Primary app:** [jobs-workflows](../../../../workspaces/apps/_todo/jobs-workflows/) · **Prereqs:** redis · **Status:** todo

## Scope

- BullMQ on top of Redis: queues, workers, flows, repeatable jobs.
- Optional Temporal / Step Functions comparison for durable workflows.
- Retries with exponential backoff; failed-job retention.
- Concurrency per worker; rate limits per queue.
- Observability via BullMQ's event stream.
- Ports for queue, mailer, SMS, and webhook clients.

## Sub-tasks

- [ ] Build a worker that processes "send email" jobs with retries and a dead-letter queue.
- [ ] Make the handler idempotent — keyed on an idempotency id from the job payload.
- [ ] Add a repeatable job (daily cleanup) and observe timing across restarts.
- [ ] Wire BullMQ events to your structured logger.
- [ ] Add a webhook job with signature verification and retry-safe delivery.
- [ ] Compare ECS worker deployment with Step Functions/Lambda for the same workflow.

## Concepts to know

- Redis persistence matters — AOF or RDB for job durability.
- Backoff strategy: `exponential` with jitter beats linear for retries.
- Separate queue per job type makes monitoring and scaling cleaner.
- Long jobs need heartbeats / `updateProgress` to avoid stall detection.
- Outbox + queue relay protects DB-write-plus-job-publish paths from dual writes.
- Temporal / Step Functions buy durable orchestration at higher platform complexity.

## Interview questions

- When do you pick BullMQ over SQS?
- How do you prevent a poison message from blocking the queue?
- Workers keep duplicating work after restart — what's wrong?
- Design idempotent email sending with BullMQ.
- BullMQ vs Temporal vs Step Functions — decision framework?
