# Terraform / CDK (IaC)

**Category:** devops-ci-cd · **Primary app:** [shop-feature-fastify](../../../../workspaces/apps/shop-feature-fastify/) · **Prereqs:** aws · **Status:** todo

## Scope

- Terraform state management (remote S3 + DynamoDB lock).
- CDK as code-first alternative; compiled to CloudFormation.
- Drift detection and remediation.
- Environment separation: workspaces, stacks, accounts.

## Sub-tasks

- [ ] Pick CDK for shop-feature-fastify; stand up the stack described in [../../cloud-services/aws/](../../cloud-services/aws/).
- [ ] Wire CDK deploy into GitHub Actions using OIDC.
- [ ] Document the environment strategy (dev / staging / prod account isolation).

## Concepts to know

- Never edit resources in the console if IaC manages them — drift.
- State file contains secrets; protect access.
- Small changes beat one-shot rewrites; keep plans readable.
- CDK escapes with `CfnResource` when L2 constructs don't support something.

## Interview questions

- Terraform vs CDK — decision framework.
- How do you handle secrets in Terraform state?
- Someone hotfixed prod in the console. How do you detect and recover?
- Blue-green deploys via IaC — how?
