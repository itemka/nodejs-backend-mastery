# Commit Message Template

Keep the first line as a concise Conventional Commit title. Add a body only when extra context helps; skip it for single-purpose commits where the subject is self-explanatory.

For the common case where the subject needs only a little detail, use a compact bullet body:

```text
type(scope): summary

- Main change 1
- Main change 2
- Main change 3
```

Rules:

- Leave one blank line after the subject.
- Use `-` for each bullet.
- Write one bullet per logical change, in imperative mood.
- Keep bullets to one line when practical.
- Order bullets by importance or logical sequence.

When motivation, validation, or breaking-change context belongs in the commit itself, use labeled sections:

```text
type(scope): summary

Why:
- Problem, motivation, or context.

What:
- Main change 1.
- Main change 2.

Validation:
- Command/result, or "Not run: reason".

BREAKING CHANGE:
- None, or describe the incompatible API/schema/config change.
```
