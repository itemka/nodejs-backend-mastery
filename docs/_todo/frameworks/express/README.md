# Express middleware & lifecycle

**Category:** frameworks · **Primary app:** [shop-mvc-express](../../../../workspaces/apps/shop-mvc-express/) · **Prereqs:** event-loop · **Status:** partial

## Scope

- Express 5 request lifecycle: router → middleware chain → route handler → error handler.
- Middleware signature `(req, res, next)` and `(err, req, res, next)` for error handlers.
- Central error translation through [HttpError](../../../../workspaces/packages/errors/) + content-negotiated HTML/JSON responses.
- Async route wrappers so thrown errors reach the error middleware.

## Sub-tasks

- [ ] Audit current [src/middleware/](../../../../workspaces/apps/shop-mvc-express/src/middleware/) for order correctness (parsers → auth → routes → error).
- [ ] Wrap all async route handlers with [wrapAsync](../../../../workspaces/apps/shop-mvc-express/src/utils/wrapAsync.ts) (or `express-async-errors`).
- [ ] Add `/health` and `/ready` endpoints bypassing auth, wired to the existing shutdown drain in [src/infra/shutdown.ts](../../../../workspaces/apps/shop-mvc-express/src/infra/shutdown.ts).
- [ ] Declare [packages/config](../../../../workspaces/packages/config/) and [packages/errors](../../../../workspaces/packages/errors/) as workspace dependencies of shop-mvc-express, matching its existing imports.
- [ ] Document the final middleware chain in this file once stable.

(Request-ID middleware lives in [observability/logging](../../observability/logging/) — one owner per sub-task.)

## Concepts to know

- Order matters: body parsers, cookie parser, auth, routes, 404, error.
- Why error middleware needs 4 args to be recognized.
- Express 5 auto-catches rejected promises from route handlers (5.x behavior change).
- Content negotiation: render HTML vs JSON from the same error.
- Graceful shutdown: `server.close()` + in-flight drain.

## Interview questions

- Explain middleware in Express. What order do you register them in and why?
- How does Express 5 differ from 4 for async error handling?
- How does your error middleware know whether to render HTML or JSON?
- Walk through a request from arriving at the socket to leaving as a JSON response.
