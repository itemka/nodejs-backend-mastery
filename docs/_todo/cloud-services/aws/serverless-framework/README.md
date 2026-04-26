# SAM / Serverless Framework / CDK

**Category:** cloud-services/aws · **Primary app:** [serverless-toolkit](../../../../../workspaces/apps/serverless-toolkit/) · **Prereqs:** lambda-api-gateway · **Status:** todo

## Scope
- AWS CDK (TypeScript) — real code, L2/L3 constructs.
- AWS SAM — CFN-flavored, Lambda-optimized.
- Serverless Framework — YAML + plugin ecosystem.
- When each fits; lock-in implications.

## Sub-tasks
- [ ] Pick CDK for serverless-toolkit; stand up the stack.
- [ ] Write a short comparison vs SAM and Serverless FW.
- [ ] Capture deploy times and developer ergonomics in this file.

## Concepts to know
- CDK compiles to CloudFormation; you still hit CFN limits.
- Construct libraries let you encode team conventions as reusable code.
- SAM and Serverless FW have faster feedback loops for pure Lambda shops.

## Interview questions
- CDK vs SAM vs Serverless Framework — decision framework.
- How does CDK handle drift from manual changes?
- When does Terraform win over any of the AWS-native tools?
