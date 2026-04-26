# Rate limiting

**Category:** auth-security · **Primary app:** [auth-service](../../../../workspaces/apps/auth-service/) · **Prereqs:** — · **Status:** todo

## Scope
- Algorithms: fixed window, sliding window, token bucket, leaky bucket.
- Distributed limits in Redis (atomic Lua script or `INCR + EXPIRE`).
- Per-IP, per-user, per-endpoint; combined policies.
- Account lockout vs soft throttle — when each fits.

## Sub-tasks
- [ ] Add `express-rate-limit` on auth routes in shop-mvc-express; document limits here.
- [ ] In auth-service, implement a Redis token-bucket limiter for `login` / `signup` / `reset`.
- [ ] Expose rate-limit status in response headers (`RateLimit-*`).
- [ ] Document the chosen thresholds and the reasoning.

## Concepts to know
- Fixed windows are burstable at boundaries; sliding/token-bucket smoother.
- Key by `(ip, endpoint)` for anonymous, `(user_id, endpoint)` for authenticated.
- Always fail-open on the limiter's dependency failure; log loudly.
- Legit bots (search engines) may hit limits; maintain an allowlist for known IPs if needed.

## Interview questions
- Compare the four rate-limit algorithms. Which is your default?
- How do you implement a shared limiter across N app instances?
- Login endpoint is being brute-forced. Design the response.
- Thundering herd on retry — what knobs do you turn?
