# Memory leaks

**Category:** performance-optimization · **Primary app:** — · **Prereqs:** profiling · **Status:** todo

## Scope

- Heap snapshots (`--heapsnapshot-signal=SIGUSR2`, Chrome DevTools).
- Retainers: closures, timers, event listeners, caches without bounds.
- `--inspect` + `heapdump` module.
- Detecting: growing RSS, growing retained size across snapshots.

## Sub-tasks

- [ ] Induce a small leak in a demo app; walk through locating it with heap snapshots.
- [ ] Document the Three Snapshots technique (baseline → load → load again) here.

## Concepts to know

- RSS growth ≠ always a leak; GC may be lazy.
- Closures capture their enclosing scope entirely — be careful with large contexts.
- Unbounded caches and registries are the top cause.
- Timers + listeners outlive the objects that registered them unless cleaned up.

## Interview questions

- Your Node process RSS grows 100MB/day. Walk through diagnosis.
- What's the Three Snapshots technique?
- Why is `setInterval` a common leak source?
