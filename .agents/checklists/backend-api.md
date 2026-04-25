# Backend API Checklist

- Route path, HTTP method, and resource naming are clear.
- Request body, query, params, and headers are validated.
- Response shape is documented or consistent with existing API style.
- Status codes match success, validation, auth, not found, conflict, and server-error cases.
- Error response shape is stable and does not leak internals.
- Authn and authz are enforced at the correct boundary.
- Idempotency is considered for create/update operations with external side effects.
- Pagination, filtering, sorting, and limits are considered for list endpoints.
- Business logic is not buried in route handlers when a service layer exists.
- Tests cover happy path, invalid input, not found, permission denial, and key edge cases.
- Docs, examples, or client contracts are updated when behavior changes.
