# PR Description Template

## Title

[Short one-line title]

## Summary

[Two or three sentences explaining what changed and why.]

## Changes

[Logical area] - [What was done and why.]

[Logical area] - [What was done and why.]

## Validation

[Commands run and results, or state that validation was not run/provided.]

## Risks

[Known risks, weak coverage, behavior needing review, or omit when not relevant.]

## Rollback

[How to revert or disable the change, or omit when not relevant.]

## Screenshots Or Examples

[Screenshots, recordings, curl output, logs, or examples when relevant.]

## Checklist

- [ ] Diff is focused.
- [ ] Tests or relevant validation were run or explicitly noted.
- [ ] Docs or examples were updated when needed.
- [ ] Migration or rollback notes are included when needed.
- [ ] No secrets or local machine paths are included.

For small single-concern PRs, omit the `Changes` section when the summary is
enough. Omit optional sections that do not add review value unless the target
repository's PR template requires them.
