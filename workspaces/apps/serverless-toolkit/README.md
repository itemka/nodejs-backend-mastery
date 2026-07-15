# Serverless Toolkit

**Status:** scaffold — planned Phase 6 (cloud/deployment), app order #6. No
code yet; this is a plan brief that absorbs the `media-service` S3/CloudFront
scope. See
[docs/README.md § App Order And Growth Phases](../../../docs/README.md#app-order-and-growth-phases).

- Why: many orgs mix FaaS with services.
- Covers: API Gateway + Lambda handlers, DynamoDB (TTL, GSIs), SQS workers,
  EventBridge scheduled jobs, Secrets Manager, IaC; S3 uploads with presigned
  URLs, streaming downloads with backpressure, and CloudFront delivery
  (absorbed from the `media-service` brief).
- Stack: AWS CDK/SAM/Terraform, DynamoDB, SQS, EventBridge, S3/CloudFront.
- Arch: function-per-use-case + shared lib package.
- Stretch: Step Functions workflow, cold-start mitigation, Lambda Powertools.

When implementation starts, reuse the existing shared packages
([config](../../packages/config/), [errors](../../packages/errors/)).

## Deployment (planned)

- Target: 100% AWS CDK (stacks for API GW, Lambda, DynamoDB, SQS, EventBridge, S3/CloudFront)
- AWS: CDK apps, CloudFormation, Lambda, API Gateway, DynamoDB, SQS, EventBridge, S3, CloudFront

## CI/CD (GitHub Actions, planned)

- Auth: OIDC to AWS
- Steps: `cdk bootstrap` (once) → `cdk deploy` with environment approvals
- Extras: canary deployments, parameterized stacks, per-env config
