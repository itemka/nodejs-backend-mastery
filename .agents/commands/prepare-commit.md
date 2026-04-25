# Prepare Commit

## Goal

Inspect the current diff and prepare clean commit message options.

## Context To Provide

- Current task or issue.
- Preferred commit granularity.
- Tests run and known failures.

## Required Steps

1. Inspect git status and diff.
2. Group changes logically.
3. Suggest Conventional Commit message(s).
4. Include why, what changed, validation, and breaking changes if any.
5. Do not commit unless explicitly asked.

## Output Format

- Suggested commit message.
- Optional split plan.
- Why.
- What changed.
- Validation.
- Breaking changes.

## Safety Notes

Do not include secrets, local paths, or unverifiable claims in commit text.
