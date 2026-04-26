# Git strategies

**Category:** devops-ci-cd · **Primary app:** — · **Prereqs:** — · **Status:** todo

## Scope
- Trunk-based development with short-lived branches.
- Git Flow (legacy; rarely worth it now).
- Release strategies: merge queues, semver, changelogs (e.g. Changesets).
- Commit hygiene: atomic commits, conventional commits.

## Sub-tasks
- [ ] Adopt trunk-based: every branch merges to `main` via PR; no long-lived develop branch.
- [ ] Write the branch naming + PR rules in this file.

## Concepts to know
- Short-lived branches keep rebase pain low.
- Merge queue serializes merges; reduces broken-main incidents.
- Conventional commits enable automated changelogs and semver bumps.

## Interview questions
- Trunk-based vs GitFlow — why does trunk-based win for most teams?
- How do you prevent broken main?
- Design releases for a library vs a service.
