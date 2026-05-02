# gRPC

**Category:** api-design · **Primary app:** — · **Prereqs:** rest · **Status:** todo

## Scope

- Protobuf schema, code-gen, and the wire format.
- Unary / server-streaming / client-streaming / bidi.
- HTTP/2 multiplexing and flow control.
- When to pick gRPC over REST: internal service-to-service, typed contracts, streaming.

## Sub-tasks

- [ ] Define a proto for one shop call; generate TS stubs.
- [ ] Stand up a gRPC server + client in-repo; measure latency vs REST for the same call.
- [ ] Document tooling pain: browser support, debugging, observability.

## Concepts to know

- gRPC-Web and Connect as browser-friendly alternatives.
- Deadlines/timeouts are first-class; propagate through call chain.
- Interceptors for auth, logging, tracing.
- No native caching — gRPC is request/response inside HTTP/2, not cache-friendly.

## Interview questions

- When would you use gRPC instead of REST between services?
- Explain the four RPC types and give an example use case for each.
- What do you lose by moving from REST to gRPC?
