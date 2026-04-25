# Security Review Checklist

- Input validation exists at every external boundary.
- Authn verifies identity, token/session expiry, and invalid credentials.
- Authz checks tenant, org, owner, role, and action scope where relevant.
- Secrets, API keys, tokens, passwords, and private URLs are not committed or logged.
- Dependency changes are necessary and do not introduce obvious supply-chain risk.
- SQL, shell, template, URL, path, and serialization injection risks are handled.
- Sensitive data is redacted from logs, errors, traces, analytics, and test fixtures.
- Rate limiting, request-size limits, and abuse controls exist where needed.
- CORS, security headers, cookies, CSRF, and CSP are handled where relevant.
- Error responses do not expose stack traces, config, or internal implementation details.
