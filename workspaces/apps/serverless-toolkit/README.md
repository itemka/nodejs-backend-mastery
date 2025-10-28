<!-- TODO: Re-evaluate scope and approach before starting implementation. -->

# Serverless Toolkit

Build them in one monorepo (`nodejs-backend-mastery`) and reuse shared packages (config/logger/errors/metrics/testing).

- Why: Many orgs mix FaaS with services.
- Covers: API Gateway + Lambda handlers, DynamoDB (TTL, GSIs), SQS workers, EventBridge scheduled jobs, secrets manager, IaC.
- Stack: AWS CDK/SAM/Terraform, DynamoDB, SQS, EventBridge.
- Arch: Function-per-use-case + shared lib package.
- Stretch: Step Functions workflow, cold-start mitigation, Lambda Powertools.

## Deployment

- Target: 100% AWS CDK (stacks for API GW, Lambda, DynamoDB, SQS, EventBridge)
- AWS: CDK apps, CloudFormation, Lambda, API Gateway, DynamoDB, SQS, EventBridge

## CI/CD (GitHub Actions)

- Auth: OIDC to AWS
- Steps: `cdk bootstrap` (once) → `cdk deploy` with environment approvals
- Extras: Canary deployments, parameterized stacks, per-env config
