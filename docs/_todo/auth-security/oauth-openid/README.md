# OAuth 2.0 / OIDC

**Category:** auth-security · **Primary app:** [auth-service](../../../../workspaces/apps/auth-service/) · **Prereqs:** jwt · **Status:** todo

## Scope

- Authorization Code Grant + PKCE (public clients).
- OIDC on top of OAuth2: `id_token`, standard claims.
- State parameter for CSRF protection on the redirect.
- Upserting the user locally and issuing your own tokens.

## Sub-tasks

- [ ] Integrate Google (or GitHub) OAuth2 in auth-service.
- [ ] Implement full flow: `/oauth/start` → provider consent → `/oauth/callback`.
- [ ] Upsert user by provider + subject; link to existing accounts by verified email.
- [ ] Issue local access + refresh tokens after provider auth succeeds.
- [ ] Enforce `state` + `nonce` parameters; reject mismatches.

## Concepts to know

- OAuth2 = authorization; OIDC = authentication on top.
- PKCE prevents stolen auth codes from being exchanged by an attacker.
- Never trust the provider's email alone unless it's marked verified.
- Store provider refresh tokens only if you need offline access.

## Interview questions

- Walk through an OAuth2 code-grant flow with PKCE.
- What does the `state` parameter prevent? What about `nonce`?
- OAuth2 vs OIDC — where exactly is the line?
- User signs up with Google using an email that already exists. What happens?
