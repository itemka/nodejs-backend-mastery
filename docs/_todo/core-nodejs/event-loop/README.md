# Event loop & phases

**Category:** core-nodejs · **Primary app:** all · **Prereqs:** — · **Status:** todo

## Scope
- Event-loop phases: timers, pending callbacks, poll, check, close.
- Microtask queue: `process.nextTick` (priority) vs Promise jobs.
- libuv thread pool and which APIs hit it (`fs`, DNS, crypto, zlib).
- Non-blocking I/O model: CPU-bound work blocks everything on the main thread.

## Sub-tasks
- [ ] Write a 1-page note explaining the six phases with a minimal repro per phase.
- [ ] Add a demo app that intentionally blocks the loop (busy loop + `setTimeout`) and measure observed delay.
- [ ] Document how `process.nextTick` can starve the I/O phase if mis-used.
- [ ] Cross-link [../streams-buffering/](../streams-buffering/) and [../child-process-cluster/](../child-process-cluster/) as mitigations for CPU-bound work.

## Concepts to know
- Phases order and what each one drains.
- Difference between macrotasks and microtasks in Node vs browsers.
- `setImmediate` vs `setTimeout(fn, 0)` scheduling.
- Graceful shutdown: SIGTERM/SIGINT handling, drain in-flight requests before exit.
- `AbortController` + signals for cancellable I/O.

## Interview questions
- How does the event loop handle a CPU-bound loop vs an I/O-bound wait? What blocks what?
- Why is `process.nextTick` dangerous if mis-used?
- Explain the difference between `setImmediate` and `setTimeout(fn, 0)`.
- How do you shut down a Node process without dropping in-flight requests?
- Which Node APIs use the libuv thread pool?
