# Lambda + API Gateway

**Category:** cloud-services/aws · **Primary app:** [serverless-toolkit](../../../../../workspaces/apps/serverless-toolkit/) · **Prereqs:** aws · **Status:** todo

## Scope
- Lambda execution model: init → invoke; container reuse; cold starts.
- Provisioned concurrency to cap cold-start latency.
- API Gateway: HTTP API (v2, cheaper) vs REST API (v1, more features) vs WebSocket API.
- Event sources: API GW, SQS, EventBridge, S3, DynamoDB Streams.
- Cost model: per-invocation + per-GB-second.

## Sub-tasks
- [ ] Build a CDK stack: API Gateway (HTTP) → Lambda → DynamoDB CRUD on a simple resource.
- [ ] Add an EventBridge rule → Lambda daily cleanup job.
- [ ] Add an SQS queue → Lambda consumer with DLQ and retry policy.
- [ ] Measure cold vs warm latency; record numbers here.
- [ ] Write a comparison note: Lambda vs ECS Fargate for the shop APIs.

## Concepts to know
- Each Lambda instance handles one request at a time (until concurrency is configured).
- DB connections: Lambda + RDS = connection explosion. Use RDS Proxy.
- Timeouts: API GW v2 max 30s; Lambda max 15m.
- Structured logs via stdout go to CloudWatch Logs automatically.

## Interview questions
- Lambda vs ECS Fargate — when each?
- Explain the Lambda execution model and what causes cold starts.
- Why does Lambda+RDS usually need RDS Proxy?
- Timeouts: where do they come from and how do you reason about them?
