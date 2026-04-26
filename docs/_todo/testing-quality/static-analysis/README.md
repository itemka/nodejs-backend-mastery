# Static analysis

**Category:** testing-quality · **Primary app:** all · **Prereqs:** — · **Status:** partial

## Scope
- ESLint flat config with `recommendedTypeChecked` + `stylisticTypeChecked` + `projectService`.
- Prettier for formatting; no bikeshedding.
- SonarCloud for cross-PR quality gates + security.
- `audit-ci --high` for dep vulnerabilities; Gitleaks + Trivy.

## Sub-tasks
- [ ] Keep the current ESLint flat config in [../../../../eslint.config.mjs](../../../../eslint.config.mjs).
- [ ] Ensure every new tsconfig is picked up by `projectService: true`.
- [ ] Add SonarCloud quality gate to CI; document thresholds here.
- [ ] Keep typed rules strict; don't relax them outside `**/*.{test,spec}.*`.

## Concepts to know
- Typed-lint rules require typecheck to run — slower but much stronger.
- `verbatimModuleSyntax` forces `import type` for types; enforced by `consistent-type-imports`.
- `perfectionist/sort-*` rules auto-fix import groups and object key order on `pnpm lint:fix`.

## Interview questions
- Why typed ESLint rules vs syntactic?
- How do you keep a static-analysis config from drifting across a monorepo?
- What static checks belong at pre-commit vs CI vs scheduled?
