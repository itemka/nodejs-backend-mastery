# AWS core (ECS Fargate, RDS, ElastiCache, VPC)

**Category:** cloud-services · **Primary app:** [shop-feature-fastify](../../../../workspaces/apps/shop-feature-fastify/) · **Prereqs:** docker · **Status:** todo

## Scope

- VPC: public vs private subnets, NAT, security groups vs NACLs.
- ECS Fargate: task definitions, services, auto-scaling, ALB target groups.
- RDS Postgres: Multi-AZ, read replicas, parameter groups.
- ElastiCache Redis: cluster vs single-node, failover.
- IAM: roles, policies, trust relationships, OIDC for CI/CD.
- Secrets Manager vs SSM Parameter Store.
- CloudWatch Logs / Metrics / Alarms.

## Sub-tasks

- [ ] Author a CDK (or Terraform) stack: VPC + public/private subnets, ALB, ECS service, RDS, ElastiCache, ECR.
- [ ] Put RDS and ElastiCache in private subnets; restrict SGs to ECS-only ingress.
- [ ] Inject secrets from Secrets Manager into the task definition as secret env vars.
- [ ] Configure CloudWatch log groups, container insights, alarms on 5xx rate and p95 latency.
- [ ] Write the full architecture diagram in this file once applied.

## Sub-pages

- [lambda-api-gateway/](./lambda-api-gateway/) — serverless HTTP.
- [s3-cloudfront/](./s3-cloudfront/) — object storage + CDN.
- [serverless-framework/](./serverless-framework/) — SAM / Serverless FW / CDK for Lambda.

## Concepts to know

- Public subnet = has IGW route; private subnet = doesn't.
- Task role = what the task can do; execution role = what ECS can do to start the task.
- RDS Multi-AZ is HA only; read replicas are read-scale only (not HA).
- ElastiCache single-node has no failover — Multi-AZ cluster for prod.
- Grant IAM at the task role; don't hand out credentials.

## Interview questions

- Draw your shop's AWS architecture. Where is traffic terminated, where do secrets live?
- Task role vs execution role — what goes in each?
- Lambda vs ECS Fargate — decision framework (see [lambda-api-gateway](./lambda-api-gateway/)).
- How does ECS do rolling deployments? What can go wrong?
