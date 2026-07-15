# Streams & backpressure

**Category:** core-nodejs · **Primary app:** [serverless-toolkit](../../../../workspaces/apps/serverless-toolkit/) · **Prereqs:** event-loop · **Status:** todo

## Scope

- Readable / Writable / Duplex / Transform stream types.
- Backpressure via `highWaterMark` and `drain` events.
- `pipeline` + `finished` for correct error propagation and cleanup.
- Buffers and binary data; `TextEncoder` / `TextDecoder`.

## Sub-tasks

- [ ] Build an S3 download endpoint in serverless-toolkit that streams objects without buffering the full file in memory.
- [ ] Demo a slow-consumer scenario; measure memory with and without `pipeline`.
- [ ] Write a Transform stream that chunks CSV rows and emits parsed objects.
- [ ] Document a memory regression you produced intentionally by ignoring backpressure.

## Concepts to know

- When a Readable emits `data` vs when you pull with `read()`.
- What "paused" vs "flowing" mode means and how to switch.
- Why `for await` over an async iterator is usually the cleanest consumer.
- Error handling: why `.pipe()` leaks vs `pipeline()` cleaning up.

## Interview questions

- Explain backpressure with a streaming S3 download example.
- Why can `.pipe()` leave resources open on error? What fixes it?
- When would you write a custom Transform stream instead of processing in-memory?
- How do `Buffer`, `Uint8Array`, and string interact? When does each win?
