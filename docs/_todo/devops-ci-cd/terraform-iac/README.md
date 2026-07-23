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
- [ ] Before the first stack lands, decide where the IaC review gate lives — a section here or a checklist in `.agents/checklists/` — and record the choice.
- [ ] Document the environment strategy (dev / staging / prod account isolation).

## Concepts to know

- Never edit resources in the console if IaC manages them — drift.
- State file contains secrets; protect access.
- Small changes beat one-shot rewrites; keep plans readable.
- AI-generated infrastructure needs a requirements gate before generation — backend, workspace, naming, region, tags, and network are asked for, never guessed. Plausible-looking infrastructure that is wrong for the environment is the common failure.
- `fmt`, `validate`, and scanners are a mandatory gate but not proof: they check syntax and known patterns, not whether the stack is correct for this environment. High-severity findings block; deferring a low-severity one needs a written reason.
- `terraform plan` runs only on explicit request. Serialize plans that target the same backend state or workspace to avoid lock contention and confusing output; independent states may plan concurrently when intended.
- CDK escapes with `CfnResource` when L2 constructs don't support something.

## Interview questions

- Terraform vs CDK — decision framework.
- How do you handle secrets in Terraform state?
- Someone hotfixed prod in the console. How do you detect and recover?
- Blue-green deploys via IaC — how?
- How would you let an AI assistant write Terraform without losing auditability?
