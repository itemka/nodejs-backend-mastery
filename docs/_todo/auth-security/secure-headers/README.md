# Secure headers (Helmet, CSP)

**Category:** auth-security · **Primary app:** [shop-mvc-express](../../../../workspaces/apps/shop-mvc-express/) · **Prereqs:** express · **Status:** partial

## Scope
- Helmet defaults and what each header does.
- Content Security Policy (CSP): source lists, `nonce`/`hash`, reporting.
- HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`.
- CORS: preflight, credentials, exposed headers.

## Sub-tasks
- [ ] Keep the current custom CSP in shop-mvc-express; document each directive here.
- [ ] Enable CSP report-only for a release, then switch to enforcing.
- [ ] Configure CORS narrowly: explicit origins, credentials only when needed.
- [ ] Add HSTS with `includeSubDomains` once HTTPS is everywhere.

## Concepts to know
- CSP is defense-in-depth against XSS, but needs tuning for inline scripts/styles.
- `unsafe-inline` defeats the point; use `nonce` or `hash` instead.
- CORS is not a security boundary — it's browser policy.
- Helmet headers don't protect against server-side vulnerabilities.

## Interview questions
- Walk through Helmet's defaults and what each header defends against.
- Design a CSP for an HTML app that needs inline event handlers from a third-party widget.
- CORS rejects your request — walk me through diagnosis.
- Why is HSTS preloaded separately from HSTS headers?
