# PR Readiness Checklist

- Diff is focused on one coherent change.
- The diff is small enough to review in one sitting — beyond roughly 400 changed lines, it is split or the PR explains why it must land together.
- Unrelated refactors, formatting churn, and dependency upgrades are absent or explained.
- Tests, typecheck, lint, build, or relevant checks were run and reported.
- Docs, examples, API notes, or migration instructions are updated when behavior changes.
- Migration, rollout, and rollback notes are included when data or config changes.
- Risks and follow-ups are explicit.
- The PR names what needs human eyes: the riskiest part of the diff and anything that was not verified.
- AI review findings are addressed, or each one left unaddressed carries a written reason.
- Screenshots, recordings, API examples, or curl output are included when relevant.
- No secrets, tokens, private URLs, credentials, or local absolute paths are included.
- Commit message and PR description match the actual diff.
