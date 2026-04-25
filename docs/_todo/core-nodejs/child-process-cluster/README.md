# Child processes, workers, cluster

**Category:** core-nodejs · **Primary app:** — · **Prereqs:** event-loop · **Status:** todo

## Scope
- `child_process` (`spawn`, `fork`, `exec`) — when each fits.
- `worker_threads` — shared memory via `SharedArrayBuffer`, message passing.
- `cluster` module vs process manager (PM2 / systemd / ECS).
- When to reach for a separate service instead of workers.

## Sub-tasks
- [ ] Move one CPU-bound operation (e.g. image resize, PDF render) to a `worker_threads` pool; benchmark.
- [ ] Write a short note comparing `cluster` with ECS horizontal scaling — when cluster still earns its keep.
- [ ] Demo `fork` IPC between a parent and a worker with back-and-forth messages.

## Concepts to know
- Which APIs share memory (`SharedArrayBuffer`) vs copy (postMessage + transfer).
- Startup cost of a worker vs a process.
- Why `cluster` doesn't help with a single CPU-bound request.
- When to pick a separate service (another language, isolation, ops boundary).

## Interview questions
- When would you use `worker_threads` over a separate process?
- How does `cluster` differ from running N copies behind a load balancer?
- A CPU-bound endpoint tanks latency for everything else. Walk through your options.
- What does `SharedArrayBuffer` unlock and what are its hazards?
