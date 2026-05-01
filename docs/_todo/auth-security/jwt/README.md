# JWT access + refresh

**Category:** auth-security · **Primary app:** [auth-service](../../../../workspaces/apps/auth-service/) · **Prereqs:** sessions · **Status:** todo

## Scope

- JWT structure (header, payload, signature); `HS256` vs `RS256`/`ES256`.
- Short-lived access tokens + long-lived refresh tokens.
- Refresh token rotation with reuse detection.
- Server-side revocation via blacklist (short-TTL Redis) or token version.
- Account lifecycle: email verification, password reset, MFA, and device tracking.

## Sub-tasks

- [ ] Issue 15-minute access JWT + 7-day refresh token at login.
- [ ] Store refresh tokens hashed in Postgres with `user_id`, `device_id`, `expires_at`, `revoked_at`.
- [ ] Implement `/refresh` that invalidates the used row and issues a new pair.
- [ ] Detect refresh-token reuse: if a revoked row is presented, revoke the entire family.
- [ ] On logout, revoke the refresh row + add access `jti` to Redis blacklist until its `exp`.
- [ ] Publish a verifier `verifyAccessToken(jwt)` consumable by other services.
- [ ] Add email verification with single-use, time-limited tokens.
- [ ] Add password reset with hashed, single-use, time-limited tokens.
- [ ] Add optional TOTP MFA and device/session listing after the core flow works.

## Concepts to know

- JWT can't be revoked client-side; keep the access TTL short.
- Asymmetric signing (RS256/ES256) lets verifiers not hold the signing key.
- Avoid putting mutable state in claims (roles can lag until token refresh).
- `jti` claim enables per-token revocation without storing all tokens.
- Reset and verification tokens are credentials; hash them at rest like passwords.
- MFA recovery codes need the same storage treatment as passwords.

## Interview questions

- Sessions vs JWT — which did you pick and why?
- Walk through refresh-token rotation. How do you detect a stolen token?
- `HS256` vs `RS256` — when each?
- Access token says role=admin, but the admin was demoted 30s ago. What do you do?
- Design password reset without account enumeration or reusable tokens.
- When does MFA materially improve an auth service, and what recovery path do you provide?
