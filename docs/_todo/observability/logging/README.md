# Structured logging (Pino)

**Category:** observability · **Primary app:** [shop-mvc-express](../../../../workspaces/apps/shop-mvc-express/) · **Prereqs:** express · **Status:** todo

## Scope

- Pino structured JSON logs; log levels; child loggers.
- Request-ID middleware and trace-ID propagation.
- Log hygiene: no PII, no secrets, reasonable cardinality.
- Sink: stdout in prod; container runtime ships it.

## Sub-tasks

- [ ] Wire Pino in shop-mvc-express; emit JSON at info in prod, pretty in dev.
- [ ] Add a request-ID middleware; attach to `req.id` and include in every log line.
- [ ] Create a child logger per request via `req.log` for scoped fields.
- [ ] Do the same in shop-feature-fastify and chat-ws.
- [ ] Confirm logs reach CloudWatch Logs when deployed.

## Concepts to know

- Structured logs let you query by field; plain text doesn't.
- `pino-pretty` is dev-only; ship JSON.
- Never log passwords, tokens, PANs, or full JWTs.
- Keep log keys stable — your queries depend on them.

## Interview questions

- Why structured logs? Give a query you can run against JSON that you can't against text.
- What's a request ID vs a trace ID?
- Your logs are 10x what they were last week. How do you diagnose and cut cost?
- Logging PII — where does it sneak in, and how do you prevent it?
