# Release management

**Category:** deployment-strategies · **Primary app:** — · **Prereqs:** — · **Status:** todo

## Scope

- Semantic versioning and defining the release unit in a monorepo of workspaces.
- Changelogs, release notes, and PR descriptions as separate artifacts for developer, user, and reviewer audiences.
- Deriving releases from Conventional Commit history instead of assembling them by hand.
- Human approval before any release is published.

## Sub-tasks

- [ ] Decide the release unit: whole repo vs per-workspace tags, and record it in an ADR under `docs/adr/`.
- [ ] Decide changelog strategy: `CHANGELOG.md`, GitHub Releases, or both — and whether it is generated or hand-written.
- [ ] Write `scripts/release/collect-changes.mjs` to group merged work from `git log` by Conventional Commit type since the last tag.
- [ ] Produce the first release note from `docs/templates/release-notes.md` and link it here as evidence.

## Concepts to know

- Semantic Versioning communicates compatibility through MAJOR for backward-incompatible public API changes, MINOR for backward-compatible public API additions, and PATCH for backward-compatible fixes; a monorepo must define which release unit owns that promise.
- A changelog serves developers, release notes serve users, and a PR description serves reviewers — the same change needs different framing for each audience.
- Outcome-first titles describe the user-visible result: `Fix payment bug` becomes `Customers can now complete card payments without timeout errors`.
- Only merged, completed work is released; never invent business impact, benefits, or timelines.
- Conventional Commits encode features, fixes, and breaking changes so a changelog can be derived instead of hand-assembled.

## Interview questions

- How would you version and release a monorepo of independently deployable services?
- Changelog vs release notes — who reads each, and what changes between them?
- How do you keep a changelog trustworthy as a team scales?
- What would make you cut a patch release rather than fold a fix into the next minor?
