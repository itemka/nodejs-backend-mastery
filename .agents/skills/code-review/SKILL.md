---
name: code-review
description: Use to review current code or a git diff for correctness, architecture, typing, security, tests, docs, maintainability, and release risk. Triggered by requests like "review this", "audit this diff", or "check for issues".
metadata:
  created: '2026-04-25'
  status: 'baseline'
  portability: 'cross-tool'
  last-reviewed: '2026-04-28'
---

# Code Review

## Purpose

Review code changes and report actionable, evidence-grounded findings before merge. Default to a multi-pass review: critique, then self-verify, then counter-argue — so the final list is calibrated rather than first-draft.

## When To Use

- The user asks for review, audit, or feedback.
- A diff is ready and needs a quality pass.
- A risky change touches contracts, security, data, or shared code.

## Inputs

- Current git diff or target files.
- Related tests, docs, and contracts.
- Relevant checklists from `.agents/checklists/`.
- Review scope: current diff, staged diff, last commit, branch range, PR, or explicit files.
- Scope or non-goals, if parts of the diff should stay out of review.
- Review focus areas such as correctness, security, API contracts, data migration, typing, tests, or frontend UX.
- Validation already run and known weak spots, shortcuts, or areas that need extra scrutiny.

## Related Role Specs

- [code-review](../../agents/code-review.md): load for a role-shaped review pass or tool-native reviewer adapter behavior.
- [security-reviewer](../../agents/security-reviewer.md): load for security-sensitive diffs or dedicated security review.
- [backend-architect](../../agents/backend-architect.md): load for backend architecture, service boundary, data flow, or cross-module design review.
- [tests](../../agents/tests.md): load when test quality, missing coverage, or flaky validation is a major review concern.

## Workflow

Run four passes. Pass 3 is mandatory. Pass 4 is conditional on the existence of draft findings. For tiny diffs (a few lines, no shared code, no contracts) collapse passes 1–2 and still run pass 3.

### Pass 1 — Triage and scope

1. Confirm the review target and inspect `git status`.
2. Use the matching diff source, such as `git diff`, `git diff --cached`, `git show --stat --patch`, or a scoped file diff.
3. Read the diff end-to-end before forming opinions.
4. Classify touched areas (backend route, service, repository, schema, migration, frontend, tests, docs, agent/tooling).
5. Load only the checklists that match the touched areas.

### Pass 2 — Categorized critique

1. Walk the diff a second time, this time applying [code-review checklist](../../checklists/code-review.md) categories in order: correctness → architecture → typing → errors → tests → security → readability → performance → docs → agent/tooling.
2. Drop each candidate finding into the [Finding Template](#finding-template). Capture evidence as a literal quote from the diff.
3. Order categories so blocking risks (correctness, security, contracts, data) come before style or readability.
4. When a category does not apply, skip it — do not invent findings to fill it.

### Pass 3 — Self-verification (mandatory)

Re-read the draft findings against the diff and apply the [self-critique checklist](../../checklists/code-review.md#self-critique-pass). For each finding, confirm:

1. The cited file and line exist in the diff. Drop any finding whose anchor cannot be re-located.
2. The quoted evidence matches the file contents verbatim. Fix or drop quotes that drift.
3. The claim is provable from the diff or from nearby context explicitly inspected during the review. If it depends on uninspected code, runtime behavior, or assumptions, downgrade to an open question.
4. The severity matches the [Severity & Confidence](#severity--confidence) table — no cargo-culted "must-fix" labels.
5. There are no duplicates. Merge findings that share a root cause.

### Pass 4 — Counter-argument and calibration

Only run when at least one finding survived pass 3.

1. For every must-fix and should-fix finding, write the strongest one-line argument against it ("the author would defend this by …"). If the counter-argument holds, downgrade or drop the finding.
2. Re-check confidence. Findings with low confidence move to open questions.
3. Confirm the final list respects [Anti-Hallucination Guardrails](#anti-hallucination-guardrails).
4. Produce the final output using the [Output Format](#output-format).

## Finding Template

Use this shape for every concrete finding:

```text
- [<severity>] <file>:<line> — <one-line summary>
  Category: <correctness | architecture | typing | errors | tests | security | readability | performance | docs | agent/tooling>
  Evidence: "<verbatim quote from the diff>"
  Why it matters: <impact in one sentence>
  Recommendation: <smallest concrete change that addresses it>
  Confidence: <high | medium | low>
```

Open questions and test gaps use the same shape with severity replaced by `question` or `test-gap`, and `Recommendation` replaced by `What to verify`.

## Severity & Confidence

Mirror this table in the [code-review checklist](../../checklists/code-review.md#severity--confidence) — they must agree.

Severity:

- **must-fix** — bug, regression, security issue, broken contract, data loss risk, or anything that should block merge. Requires high confidence and direct evidence.
- **should-fix** — clear quality or maintainability issue with concrete impact, but not blocking. Author may defend it; reviewer should explain why the change is still worth it.
- **nice-to-have** — small improvement, taste, or local cleanup. Easy to drop without harming the change.

Confidence:

- **high** — provable from the diff alone with quoted evidence.
- **medium** — likely from the diff plus nearby context that was inspected.
- **low** — depends on unseen code, runtime behavior, or assumptions. Move to open questions instead of reporting as a finding.

## Self-Critique Checklist

Run during pass 3 against the draft findings. The full bullet list lives in the [code-review checklist](../../checklists/code-review.md#self-critique-pass). Summary:

- Every finding has a real file:line and a verbatim evidence quote.
- No finding speculates about behavior not visible in the diff or inspected nearby context.
- Severity matches the table; must-fix findings are high confidence.
- No duplicate findings or redundant suggestions.
- No finding asks for a rewrite the user did not request.

## Anti-Hallucination Guardrails

- Do not invent line numbers. If a number cannot be re-located, drop the finding.
- Quote real code from the diff. Paraphrase only inside the `Why it matters` line.
- Downgrade unprovable claims to open questions; never report them as must-fix.
- Do not flag mechanical style that linter or formatter handles.
- Do not propose unrelated refactors, renames, or dependency changes.
- Do not echo a finding from a checklist if the diff does not actually exhibit it.

## Output Format

Group findings under these headings, in order. Keep each entry in the [Finding Template](#finding-template) shape.

- **Must-fix** — blocking issues.
- **Should-fix** — non-blocking quality or maintainability issues.
- **Nice-to-have** — small suggestions.
- **Test gaps** — missing coverage or weak assertions.
- **Open questions** — anything unprovable from the diff or dependent on unseen context.
- **Confidence summary** — one sentence: how thoroughly the diff was reviewed, what was not inspected, and what residual risk remains.

If no issues are found, say so directly and still produce the confidence summary plus any test gaps and open questions.

## Safety Rules

- Prioritize bugs, regressions, and security over style.
- Include file and line references on every finding.
- Do not rewrite the code during a review unless explicitly asked.
- Do not stage, unstage, commit, or otherwise change git state during a review unless the user explicitly asks for that git action. A request to fix review findings is not a request to stage those fixes.
- Do not report speculation as a finding; use open questions or test gaps for unproven risks.
- Do not skip pass 3. A first-draft review without self-verification is unfinished.

## When Not To Use

- The user wants implementation, not review.
- There is no diff or file target to inspect.
