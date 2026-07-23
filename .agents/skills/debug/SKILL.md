---
name: debug
description: Debug failing tests, runtime errors, build errors, flaky behavior, and unclear regressions. Use when given stack traces, failing CI, symptoms, or "this isn't working".
metadata:
  created: '2026-04-25'
  status: 'baseline'
  portability: 'cross-tool'
  last-reviewed: '2026-07-23'
---

# Debug

## Purpose

Find a reproducible root cause and, when implementation is requested, apply the smallest credible fix.

## When To Use

- Tests, typecheck, lint, build, or runtime behavior fails.
- The user provides an error, stack trace, log, or broken scenario.
- A recent change caused unexpected behavior.

## Inputs

- Exact failing command, error output, stack trace, log excerpt, or observed symptom.
- Reproduction steps, input data, environment, and expected vs actual result.
- Relevant recent diff, suspected files, packages, services, configs, and affected users.
- Test and runtime commands.
- Constraints such as commands not to run, external services to avoid, data safety limits, or environment limits.

## Related Role Specs

- [debug](../../agents/debug.md): load for a role-shaped debugging pass, especially when isolating a failure before implementation.
- [tests](../../agents/tests.md): load when the failure involves flaky tests, missing regression coverage, or unclear validation scope.

## Workflow

1. Capture the exact error and failing command.
2. Run the shortest reproduction path and capture the actual output. If the bug does not reproduce, try other evidence-backed triggering conditions before concluding.
3. For a multi-stage or CI failure, read the full job log rather than a single pasted line, and find the **first** failure — later failing steps are usually cascades of it. A lone error line is not enough context to fix from; identify the failing stage and command before forming hypotheses.
4. Inspect recent changes and nearby code.
5. Form 2-3 plausible hypotheses.
6. Test hypotheses one by one until the root cause, violated invariant, and relevant `file:line` locations are supported by evidence.
7. Before changing code, state why the planned change closes the violated invariant. If that explanation does not map to the identified root cause, reconsider — the change is probably targeting a symptom.
8. If implementation is requested, fix the minimal root cause.
9. When a fix is made, add or update a regression test when practical, in the project's real test suite and matching its existing framework and naming conventions.
10. When a fix is made, re-run the reproduction against the fixed code and show the actual output. An assertion that it should now pass is not evidence.
11. When a fix is made, check its side effects: name the behavior near the change that could break (null and empty cases, boundaries, concurrent callers, changed error types, ordering, performance), each with a concrete triggering input and the `file:line` where behavior diverges. If none apply, name the callers and inputs checked and why each is unaffected.
12. Scan for the same wrong assumption elsewhere in the codebase. Report matches as `file:line` plus a short excerpt and the searches run; report no matches only alongside at least two distinct searches. Do not expand the current fix to cover them — raise them as follow-ups.
13. Report the root cause and validation.

## Output Format

- Symptom.
- Reproduction evidence: exact command and actual failing output.
- Root cause and violated invariant, with `file:line` when applicable.
- Fix, when implemented.
- Regression coverage, when implemented.
- Re-run evidence, when implemented: actual output after the fix.
- Side effects checked, when implemented, including the callers and inputs behind a "none apply" conclusion.
- Similar patterns found (`file:line` plus a short excerpt), or the searches run that found none.
- Validation.
- Remaining risk.

## Safety Rules

- Do not mask failures by weakening tests or swallowing errors.
- Do not add noisy logs unless they are removed or intentionally structured.
- Avoid broad rewrites during debugging.
- Keep diagnosis-only requests read-only; apply a fix only when the user requests implementation or the request otherwise clearly includes it.
- After three failed approaches to the same mechanical step (running a reproduction, locating a function, parsing output, detecting the test framework, executing tests), report the approaches and observed results, then ask one specific question instead of inventing further variants. Analytical uncertainty is not a blocker — pick the best-supported hypothesis, state confidence, and continue.

## When Not To Use

- The task is planned feature work with no failure to investigate.
- The user only wants a high-level explanation.
