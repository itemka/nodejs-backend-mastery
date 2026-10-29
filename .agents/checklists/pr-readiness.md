# PR Readiness Checklist

Use this checklist to review readiness; do not copy it into the PR body.
For PR content and extra sections, follow the
[pr-description skill](../skills/pr-description/SKILL.md).

- Diff is focused on one coherent change.
- The diff is small enough to review in one sitting — beyond roughly 400 changed lines, it is split or the PR explains why it must land together.
- Unrelated refactors, formatting churn, and dependency upgrades are absent or explained.
- Tests, typecheck, lint, build, or relevant checks were run and reported in CI
  or the handoff.
- Docs, examples, API notes, or migration instructions are updated when behavior changes.
- Required migration or release steps are clear; essential instructions are
  included under the PR skill's extra-section rules.
- Risks, rollback, follow-ups, and unverified areas were considered and reported
  in the handoff when needed.
- AI review findings are addressed, or each one left unaddressed carries a written reason.
- Screenshots, recordings, and examples are included in the PR only when requested.
- No secrets, tokens, private URLs, credentials, or local absolute paths are included.
- Commit message and PR description match the actual diff.
- PR text includes a title, short summary, and changes list; extra sections
  follow the PR skill's rules.
