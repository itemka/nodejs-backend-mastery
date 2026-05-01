# Sessions

**Category:** auth-security · **Primary app:** [shop-mvc-express](../../../../workspaces/apps/shop-mvc-express/) · **Prereqs:** express · **Status:** todo

## Scope

- Email/password registration and login for the monolith baseline.
- Password hashing with argon2 or bcrypt; never store plaintext or reversible passwords.
- Server-side session state in Redis (or Postgres).
- Secure cookie flags (`HttpOnly`, `Secure`, `SameSite`).
- CSRF considerations for cookie-based auth.
- Session rotation on privilege change (login, password change).

## Sub-tasks

- [ ] Implement registration + login in shop-mvc-express with hashed passwords.
- [ ] Decide sessions-or-JWT for shop-mvc-express; record the reasoning here.
- [ ] If sessions: wire `express-session` + Redis store; set all three cookie flags.
- [ ] Rotate session ID on login; destroy on logout.
- [ ] Add CSRF tokens for form routes (double-submit or synchronizer pattern).

## Concepts to know

- Argon2id is the default password-hashing choice; bcrypt is acceptable when platform support is simpler.
- Revoking sessions is trivial (delete the row); JWT revocation is harder.
- Shared session store is needed for horizontal scale.
- `SameSite=Lax` defaults block most CSRF; `Strict` breaks cross-site navigation.

## Interview questions

- How do you store passwords safely? Which parameters matter?
- Sessions vs JWT — when does sessions win?
- Why rotate the session ID on login?
- Explain CSRF and which flags / patterns mitigate it.
- How do you share sessions across multiple app instances?
