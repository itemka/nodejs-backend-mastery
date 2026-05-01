# Realtime patterns

**Category:** api-design · **Primary app:** [chat-ws](../../../../workspaces/apps/chat-ws/) · **Prereqs:** websockets · **Status:** todo

## Scope

- Long-polling, Server-Sent Events (SSE), WebSockets — trade-offs.
- Horizontal scale with Redis pub/sub, Kafka, or NATS.
- Presence tracking in Redis hash with TTL-refreshed heartbeats.
- Message ordering and delivery guarantees across instances.

## Sub-tasks

- [ ] Wire Redis pub/sub so a publish from any chat-ws instance reaches all subscribed instances.
- [ ] Document the horizontal-scale story in this README: publisher → bus → subscribers → clients.
- [ ] Track presence per room as a Redis hash; expire on heartbeat stall.
- [ ] Sketch what would change if you swapped Redis pub/sub for Kafka (durability, replay).

## Concepts to know

- SSE is one-way, simpler through proxies, no upgrade — often the right default.
- Long-poll is the universal fallback; costs more per message.
- Redis pub/sub is at-most-once; use Streams if you need at-least-once + replay.
- "Exactly-once" is a lie outside a single transaction; design idempotent consumers.

## Interview questions

- SSE vs WebSockets vs long-poll — decision framework.
- Describe your horizontal-scale design for a chat service. Where's the single point of failure?
- Why does Redis pub/sub lose messages? When is that acceptable, when not?
- Design presence for 100K concurrent users — where's the state, how does it expire?
