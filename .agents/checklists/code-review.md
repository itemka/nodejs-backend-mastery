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

## Typing

- Are TypeScript types precise and narrow?
- Are schemas used at external boundaries?
- Is `any` avoided or clearly contained?

## Errors

- Are typed errors mapped to correct outcomes?
- Are internal errors hidden from clients?
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

- Are hot paths, N+1 queries, large payloads, and unnecessary renders avoided?
- Are timeouts, pagination, caching, or batching considered where relevant?

## Docs

- Are README, API examples, migration notes, or comments updated when behavior changes?

## Agent / Tooling

- Are AI instructions, skills, agents, commands, hooks, and MCP notes scoped to the right file type?
- Do skills have focused triggers and valid frontmatter?
- Are tool adapters thin and linked to the portable source of truth?
- Are hook or MCP changes deterministic, least-privilege, and free of secrets?

## Severity & Confidence

Mirrors the definitions in [code-review skill](../skills/code-review/SKILL.md#severity--confidence). Keep both in sync.

Severity:

- **must-fix** — bug, regression, security issue, broken contract, or data loss risk that should block merge. Requires high confidence.
- **should-fix** — clear quality or maintainability issue with concrete impact but not blocking. The reviewer must explain why it is still worth fixing.
- **nice-to-have** — small improvement, taste, or local cleanup. Safe to drop.

Confidence:

- **high** — provable from the diff alone with quoted evidence.
- **medium** — likely from the diff plus inspected nearby context.
- **low** — depends on unseen code, runtime behavior, or assumptions. Move to open questions instead of reporting as a finding.

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
