# Static analysis

**Category:** testing-quality · **Primary app:** all · **Prereqs:** — · **Status:** partial

## Scope

- ESLint flat config with `recommendedTypeChecked` + `stylisticTypeChecked` + `projectService`.
- Prettier for formatting; no bikeshedding.
- SonarCloud scans in CI, conditional on a `SONAR_TOKEN` secret and non-fork PRs, with
  `sonar.qualitygate.wait=true` (`.github/workflows/ci.yml`); the active quality profile and
  historical findings live in SonarCloud and are not verifiable from the repo alone.
- Dependency Review (`fail-on-severity: high`, GitHub advisory DB) on PRs, plus Gitleaks for
  secret scanning on every non-docs-only CI run. There is no local SAST tool (for example
  Semgrep) today. The former `pnpm dlx audit-ci --high` step was removed: npm retired the
  legacy audit endpoints it depended on, so it always failed with `ERR_PNPM_AUDIT_BAD_RESPONSE`.
  There is no Trivy step in this repo's CI.

## Sub-tasks

- [ ] Keep the current ESLint flat config in [../../../../eslint.config.mjs](../../../../eslint.config.mjs).
- [ ] Ensure every new tsconfig is picked up by `projectService: true`.
- [ ] Verify and document the active SonarCloud quality gate/profile thresholds here (the scan
      itself is already wired into CI; only the external threshold values are unverified).
- [ ] Keep typed rules strict; don't relax them outside `**/*.{test,spec}.*`.

## Concepts to know

- Typed-lint rules require typecheck to run — slower but much stronger.
- `verbatimModuleSyntax` forces `import type` for types; enforced by `consistent-type-imports`.
- `perfectionist/sort-*` rules auto-fix import groups and object key order on `pnpm lint:fix`.

## Interview questions

- Why typed ESLint rules vs syntactic?
- How do you keep a static-analysis config from drifting across a monorepo?
- What static checks belong at pre-commit vs CI vs scheduled?
