# Mutation testing (Stryker)

**Category:** testing-quality · **Primary app:** — · **Prereqs:** unit-testing · **Status:** todo

## Scope
- Stryker introduces small code changes; surviving mutants mean weak tests.
- Mutation score as a complement to line coverage.
- Cost: slow; run in nightly or weekly CI.

## Sub-tasks
- [ ] Run Stryker once against a service layer; record mutation score here.
- [ ] Strengthen the three weakest tests based on surviving mutants.

## Concepts to know
- 100% line coverage can still leave branches untested — mutation catches that.
- Not every surviving mutant is a real bug — equivalent mutants exist.
- Run on changed files only in PR to keep feedback fast.

## Interview questions
- What does mutation testing find that line coverage misses?
- When is Stryker worth the CI time?
- What's an equivalent mutant and how do you handle it?
