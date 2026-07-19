# Mutation testing (Stryker)

**Category:** testing-quality · **Primary app:** — · **Prereqs:** unit-testing · **Status:** partial

## Scope

- Stryker introduces small code changes; surviving mutants mean weak tests.
- Mutation score as a complement to line coverage.
- Cost: slow; run in nightly or weekly CI.

## Sub-tasks

- [x] Run Stryker once against a service layer; record mutation score here. — one-file manual
      pilot only (`workspaces/ai-engineering/rag-pipeline/src/retrieval/rrf.ts`, RRF fusion/
      tie-break logic), via `pnpm --filter rag-pipeline run test:mutation`
      (`@stryker-mutator/core` + `@stryker-mutator/vitest-runner`, config in
      `workspaces/ai-engineering/rag-pipeline/stryker.config.json`). Report-only: no CI wiring,
      no score threshold. First run: 52/72 mutants killed (72.22%). After strengthening tests:
      **67/72 killed (93.06%)**, 8s wall time for the full pilot run.
- [x] Strengthen the three weakest tests based on surviving mutants. — added a `k === 0`
      boundary case, an "own-index fields present / other-index fields absent" test using
      `Object.hasOwn` (a `.toBeUndefined()` check cannot distinguish an omitted key from
      `{ key: undefined }`, which is exactly what several surviving mutants exploited), and a
      combined exact-fusedScore + equal-score tie-break test
      (`workspaces/ai-engineering/rag-pipeline/tests/retrieval/rrf.test.ts`).

## Pilot result (rrf.ts, one-time run)

The 5 remaining surviving mutants after strengthening were individually classified rather than
chased to 100%:

- **Accepted, not fixed (2 mutants, lines 43 and 61):** only reachable if the _same_ chunk id
  appears twice within one index's own hit list (e.g. two semantic hits for the same chunk).
  Neither index currently returns duplicate ranks for one chunk, so this input shape does not
  occur from real callers; adding a test for it would test an unreachable case rather than
  real behavior.
- **Equivalent mutants (3 mutants, lines 108, 113, 115 — the equal-fusedScore tie-break path):**
  `fused` is built by iterating `merged.values()` in the exact order chunks were first
  inserted — the same order `insertionOrder` records — and `Array.prototype.sort` is a
  guaranteed-stable sort in V8/Node. So when fused scores are equal, skipping the
  insertion-order comparison (or feeding it a wrong operator) still yields the same relative
  order the stable sort would have produced from the pre-sort array. No input can distinguish
  these mutants from correct behavior; forcing a "kill" would only be testing sort stability,
  not `rrf.ts` behavior.

## Concepts to know

- 100% line coverage can still leave branches untested — mutation catches that.
- Not every surviving mutant is a real bug — equivalent mutants exist.
- Run on changed files only in PR to keep feedback fast.

## Interview questions

- What does mutation testing find that line coverage misses?
- When is Stryker worth the CI time?
- What's an equivalent mutant and how do you handle it?
