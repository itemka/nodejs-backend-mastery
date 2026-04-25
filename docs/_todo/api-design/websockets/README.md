# WebSockets

**Category:** api-design · **Primary app:** [chat-ws](../../../../workspaces/apps/chat-ws/) · **Prereqs:** event-loop · **Status:** todo

## Scope
- WebSocket handshake (HTTP Upgrade), frames, ping/pong.
- Raw `ws` vs socket.io — what socket.io adds (rooms, auto-reconnect, fallback).
- Rooms, presence, typing indicators.
- Auth on upgrade; rate limiting per connection.
- Graceful disconnect and reconnection strategy.

## Sub-tasks
- [ ] Scaffold chat-ws on Fastify + `@fastify/websocket` (or socket.io).
- [ ] Authenticate the upgrade using an access JWT (query param or protocol header).
- [ ] Implement room join/leave; broadcast messages within a room.
- [ ] Persist each message to Postgres with sender + timestamp.
- [ ] Add per-connection rate limiting with backpressure for slow clients.
- [ ] Drain sockets on SIGTERM before process exit.

## Concepts to know
- WebSockets hold a long-lived TCP connection; count them against file descriptors.
- ALB supports WebSockets; sticky sessions avoid bouncing mid-conversation.
- Heartbeats detect broken connections the OS hasn't surfaced yet.
- Horizontal scale needs a message bus (see [../realtime-patterns/](../realtime-patterns/) and [../../data-storage/caching/redis/](../../data-storage/caching/redis/)).

## Interview questions
- WebSockets vs SSE vs long-polling — how do you choose?
- How do you authenticate a WebSocket connection?
- What breaks first when you scale from 10K to 100K concurrent connections?
- How do you handle a slow client that can't drain the send buffer?
