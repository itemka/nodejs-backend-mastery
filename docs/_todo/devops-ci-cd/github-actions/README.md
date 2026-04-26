# GitHub Actions

**Category:** devops-ci-cd · **Primary app:** [shop-mvc-express](../../../../workspaces/apps/shop-mvc-express/) · **Prereqs:** docker · **Status:** partial

## Scope
- PR pipeline: lint, format check, typecheck, test, build.
- Path filters to run per-app jobs only when that app changed.
- OIDC federation for AWS deploy without static keys.
- Caching: pnpm store, Docker layers.
- Security: Gitleaks, Trivy, `audit-ci --high`, SonarCloud.

## Sub-tasks
- [ ] Keep the current root-level CI job (lint, format, typecheck, test).
- [ ] Add a path-filtered build job per app under `workspaces/apps/*`.
- [ ] Wire OIDC → IAM role for ECR push + ECS deploy.
- [ ] Cache pnpm store across runs keyed by lockfile.
- [ ] Fail CI on HIGH severity from `audit-ci` or Trivy.

## Concepts to know
- Use `pull_request` + `push` on main; avoid `workflow_dispatch` as the only trigger.
- Matrix builds for Node version testing.
- Secrets are masked in logs but not in artifacts — be careful.
- Reusable workflows (`workflow_call`) beat copy-paste across apps.

## Interview questions
- Design a CI pipeline for a monorepo with 5 apps.
- How do you deploy to AWS without storing access keys in GitHub?
- PR from a fork needs secrets — how do you handle that safely?
- When do matrix builds earn their time cost?
