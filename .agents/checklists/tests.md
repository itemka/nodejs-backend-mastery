# Tests

- Unit tests cover pure logic and important branches.
- Integration tests cover module boundaries, HTTP contracts, persistence, or external adapters when relevant.
- Contract tests exist for shared schemas, public APIs, provider/consumer boundaries, or event payloads when relevant.
- Fixtures are realistic enough to catch bugs but small enough to read.
- Edge cases include empty input, limits, duplicates, malformed data, and boundary values.
- Negative paths cover validation errors, permission denial, missing records, conflicts, and dependency failures.
- Tests are deterministic and do not depend on order, wall-clock time, real network, or local machine state.
- Assertions verify behavior, not implementation details.
- Tests are suitable for CI and fail with actionable messages.
- Validation commands are documented in the final report or PR.
