# Security Review Checklist

- Input validation exists at every external boundary.
- Authn verifies identity, token/session expiry, and invalid credentials.
- Authz checks tenant, org, owner, role, and action scope where relevant.
- Authorization failures on resources whose existence is itself sensitive return 404 rather than 403.
- Secrets, API keys, tokens, passwords, and private URLs are not committed or logged.
- Dependency changes are necessary and do not introduce obvious supply-chain risk.
- SQL, shell, template, URL, path, and serialization injection risks are handled; identifiers such as table, column, and sort keys use an allowlist, since parameterization does not cover them.
- Password storage uses a slow, salted algorithm (Argon2, scrypt, or bcrypt) rather than a bare fast hash; security-sensitive tokens and intentionally unguessable identifiers come from a CSPRNG; symmetric encryption is authenticated, never ECB, and follows the algorithm's nonce or IV requirements (for AES-GCM, uniqueness per key is mandatory, and deterministic and approved random constructions are both valid).
- Outbound requests to user-supplied URLs are SSRF-guarded: internal, link-local, and cloud-metadata addresses are blocked, redirects are not followed blindly, and timeout and response size are capped.
- Request payloads map onto entities through an explicit field allowlist; no bulk assignment of arbitrary keys onto a model.
- Sensitive data is redacted from logs, errors, traces, analytics, and test fixtures.
- Rate limiting, request-size limits, and abuse controls exist where needed.
- CORS, security headers, cookies, CSRF, and CSP are handled where relevant.
- Error responses do not expose stack traces, config, or internal implementation details.
- MCP, hook, and subagent changes avoid inline secrets, broad filesystem access, and unbounded external side effects.
- Prompts, files, or context sent to an external AI provider are minimized, free of secrets/PII beyond what the task needs, and the provider's retention/deletion behavior for that data is known or explicitly flagged as unknown.
