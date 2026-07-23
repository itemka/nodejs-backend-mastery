# Code Review Checklist

Use for diff-focused reviews. Lead with blocking issues and keep suggestions small.

## Correctness

- Does the change satisfy the requested behavior?
- Are edge cases, empty states, and failure paths handled?
- Are public contracts and response shapes preserved unless intentionally changed?

## Architecture

- Does the code follow existing layering and module boundaries?
- Are route handlers thin where the repo expects service or repository layers?
- Is new abstraction justified by real duplication or complexity?
- Does any function, class, or module accumulate unrelated responsibilities, or reach repeatedly into another object's internals instead of asking it for behavior?
- Does every workspace package imported by the diff (`@workspaces/...`) appear as a declared `workspace:*` dependency in the consuming package's manifest, not just a resolvable TypeScript path alias?

## Typing

- Are TypeScript types precise and narrow?
- Are schemas used at external boundaries?
- Is `any` avoided or clearly contained?
- Are magic numbers and magic strings replaced by named constants, enums, or domain types when the value carries domain meaning?
- Are lint and type suppressions (`eslint-disable*`, `@ts-expect-error`, `@ts-ignore`) justified in writing and scoped as narrowly as possible?

## Errors

- Are typed errors mapped to correct outcomes?
- Are internal errors hidden from clients?
- Does the change fix the failure or only silence it? Flag broadened `catch` blocks, swallowed errors, new fallback defaults, removed validation, and relaxed assertions when they make a symptom disappear without addressing the cause.
- Are logs useful without exposing secrets or sensitive data?

## Tests

- Are meaningful unit, integration, or contract tests updated?
- Are negative paths covered?
- Are tests deterministic and suitable for CI?

## Security

- Are validation, authn, authz, and tenant or ownership boundaries preserved?
- Are injection risks, unsafe shell or file access, and untrusted input handling checked?
- Are secrets, private URLs, sensitive data, and internal errors kept out of code, logs, and review output?

## Readability

- Are names clear and consistent with nearby code?
- Is the diff minimal and focused?
- Is duplicated or complex logic justified?

## Performance

- Are hot paths, N+1 queries, unbounded queries (no LIMIT or pagination cap), large payloads, and unnecessary renders avoided?
- Are timeouts on outbound calls, pagination, caching, or batching considered where relevant?

## Docs

- Are README, API examples, migration notes, or comments updated when behavior changes?
- If the diff adds/removes/renames an app, container, external dependency, data store, or public API boundary, is `docs/architecture/workspace.dsl` updated and re-exported (`pnpm run arch`)?
- If the diff changes a request flow, call sequence, state transitions, or retry/error/async behavior for a feature that already has a diagram, is the matching `workspaces/<area>/<workspace>/docs/<flow>.md` updated? See the [architecture-diagrams skill](../skills/architecture-diagrams/SKILL.md).

## Agent / Tooling

- Are AI instructions, skills, agents, commands, hooks, and MCP notes scoped to the right file type?
- Do skills have focused triggers and valid frontmatter?
- Are tool adapters thin and linked to the portable source of truth?
- Are hook or MCP changes deterministic, least-privilege, and free of secrets?

## Severity & Confidence

The severity and confidence definitions live in the [code-review skill](../skills/code-review/SKILL.md#severity--confidence). Apply them when labeling findings; do not restate them here.

## Self-Critique Pass

Run after drafting findings, before delivering the review.

- Every finding has a real file and line that can be re-located in the diff.
- Every finding has a verbatim evidence quote, not a paraphrase.
- No finding speculates about behavior not visible in the diff or inspected nearby context.
- Severity matches the [Severity & Confidence](#severity--confidence) table; must-fix findings are high confidence.
- No duplicate findings — merge entries that share a root cause.
- No finding requests an unrelated refactor, rename, or dependency change.
- Mechanical style issues (formatter or linter territory) are not flagged.
- For each must-fix and should-fix, state the strongest counter-argument the author could raise. If it holds, downgrade or drop the finding.
