# Telegram HTTP contracts

Shared wire schemas for `telegram-webhook-hub` and its integrations, and the retry rule both
sides share. This package has no credentials, HTTP client or persistence access. Both apps
consume it through a workspace dependency. Its runtime exports point to built JavaScript in
`dist/`, with generated TypeScript declarations, so Vercel's Node functions can resolve the
package after file tracing.

`pnpm install` builds the package through its `prepare` script. Both apps also run the build in
`vercel-build` before Vercel traces their functions. After changing a schema, or when installing
with `--ignore-scripts`, run the package build before using either app.

- `integrationUpdateSchema`: authenticated hub-to-integration `{ updateId, input }` messages
  and callbacks. The hub verifies Telegram identity and removes the integration namespace.
- `hubOperationSchema`: authenticated integration-to-hub messages, callback acknowledgements
  and button removal. Callers cannot choose a chat or invoke an arbitrary Telegram method.
- `telegramMessageSchema`: HTML text and inline keyboard, with HTTPS URL buttons and the
  64-byte callback-data limit applied to the complete namespaced value.
- `isPermanentRefusal`: the retry rule both sides share. Any 4xx except 408 and 429 is final,
  so the hub and its integrations finish the update instead of retrying it.

Integrations escape and sanitize their own message values before sending HTML. The hub validates
the contract and enforces namespace ownership. Its configured owner chat is the only destination.
Both endpoints reject extra fields rather than silently accepting undocumented capabilities.

```sh
pnpm --filter @workspaces/telegram-contracts build
pnpm --filter @workspaces/telegram-contracts test
pnpm --filter @workspaces/telegram-contracts typecheck
```

The test command rebuilds the package and tests its public JavaScript entry point.
