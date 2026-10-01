# AWS interview practice without a certification course

Use your own sandbox account. This guide does not deploy anything automatically.
The finish line is explaining a real deployment and a few small service experiments,
including one failure and cleanup for each. No full product is required.

## Before creating resources

- Confirm your account, sign-in access, billing plan and selected region. Enable
  root MFA; use a separate identity and temporary credentials for daily work.
- Configure a named CLI profile when needed and run
  `aws sts get-caller-identity --profile interview-lab` to check the target account.
  Keep its output, account identifiers and credentials outside committed notes.
- Set a small budget alert and check pricing for that account/region. Budget alerts
  are notifications, not an automatic spending cap. Do not assume Free Tier covers
  ECS, public IPv4, load balancers, NAT gateways, RDS or every request.
- Tag resources `Project=interview-lab`. Keep a private list of what you created,
  including global resources, so cleanup is verifiable.

If account setup is pending, continue Node, SQL and Docker locally. Mark AWS tasks
as "explained" until actually executed; local emulation is not deployment evidence.

## Six small exercises

Spread these over the AWS study blocks. Individual service experiments can take
30–60 minutes after setup; the first ECS deployment can need several sessions.

### A. Serverless endpoint and configuration

Learn IAM roles/policies, Lambda, API Gateway, CloudWatch and Parameter Store.

1. Create one tiny Node handler and invoke it from a test event.
2. Add an API Gateway HTTP API route and call its URL.
3. Store a non-sensitive configuration value in Parameter Store; read it using
   the function's execution role scoped to that parameter.
4. Find the invocation in CloudWatch; set short log retention and create a simple
   error alarm. Trigger a controlled error and find the corresponding signal.
5. Briefly remove the parameter permission and observe `AccessDenied`; restore it.

Evidence: HTTP response, log location, alarm behavior and an explanation of the
execution role, cold start, timeout, concurrency and why secrets are not in code.
Explain Secrets Manager rotation and KMS encryption; do not implement rotation now.
Cleanup: API/stage, function, parameter, alarm, log group and lab-specific role/policy.

### B. Private object storage and CDN

1. Upload a tiny static file to a private S3 bucket; keep Block Public Access on.
2. Serve it through CloudFront using Origin Access Control and an S3 bucket origin.
3. Fetch via CloudFront, update the object, and observe caching/versioned object names.
4. Explain why a direct anonymous S3 request fails while CloudFront succeeds.

Evidence: working CDN request, denied direct request, cache behavior and the narrow
bucket policy. Explain presigned URLs, lifecycle rules and storage classes.
Cleanup: disable/delete the distribution, remove objects including any versions,
then delete the bucket and associated lab-only access control.

### C. DynamoDB access patterns

1. Create an on-demand table for one access pattern, such as an order by ID.
2. Write, get and query items; explain Query vs Scan before reaching for a scan.
3. Use a conditional write to prevent a duplicate ID. Send it twice and explain
   the second result. Add a sort key/GSI only if your chosen query requires one.

Evidence: chosen key, a query and a rejected duplicate. Explain hot partitions,
secondary indexes and eventual vs strongly consistent reads where supported.
Cleanup: table, backups/exports created by the lab and its narrow access policy.

### D. SQS, retries and dead letters

1. Create a standard SQS queue, a DLQ and a redrive policy.
2. Attach a tiny Lambda consumer with only the permissions it needs.
3. Send a successful message and a deliberately failing message. Observe retry
   visibility and eventual movement to the DLQ.
4. Resend the same logical message. Explain why the consumer must be idempotent.
   If using batches, implement/report partial batch failures and test a mixed batch.

Evidence: one successful consumption, one DLQ message, and duplicate handling.
Explain visibility timeout vs retention, event-source retries vs Lambda async
invocation retries, and SQS vs SNS fan-out vs EventBridge routing.
Cleanup: event source mapping, queues, function, log group and lab-only roles.

### E. Deploy this NestJS container

Reuse the Dockerfile from this workspace. Do not move the whole Nest application
into Lambda merely to learn serverless; exercise A already covers that model.

1. Create a private ECR repository. Build and push a versioned image. On an Apple
   Silicon Mac, choose the same image architecture and ECS task runtime architecture
   (ARM64 or X86_64). Record the image digest for repeatable deployments.
2. Create an ECS cluster and a Fargate task definition: image digest, container port
   3000, `PORT=3000`, CPU/memory, `awslogs`, and an execution role for ECR/log access.
   Set an ECS container health check explicitly; do not assume the image's Docker
   health check is automatically used by ECS.
3. Create a service with one task. For a brief health-only lab, use a public subnet
   with an internet-gateway route and assigned public IP, and allow port 3000 only
   from your current public IP. Explain how the task reaches ECR and CloudWatch.
4. Call `/health` on the task IP, inspect its events/logs, and stop a task once to
   observe the service replace it. The replacement may get a different IP.
5. Build version 2, register a task-definition revision and update the service.
   Observe the rollout, then roll back to the previous revision/image digest.
6. Draw the production variant: HTTPS ALB across AZs, targets in private subnets,
   security-group references, readiness checks, autoscaling, and outbound access
   through appropriate VPC endpoints or NAT. Explain why the short lab differs.

Evidence: live health response, CloudWatch log, replaced task, version rollout and
rollback. Distinguish task execution role from the application's task role. Explain
CI build/test → push immutable image → deploy revision → verify → rollback; use OIDC
if later automating GitHub Actions instead of storing long-lived AWS keys.

An ALB is an extension if you need hands-on load-balancing practice; budget for it
and configure its target health checks. The first exercise needs no NAT gateway,
ALB, domain or HTTPS endpoint because it serves only disposable health information
to your IP. Do not use that layout for authentication or customer data.

Cleanup: scale the service to zero and delete it, stop any standalone tasks, delete
the cluster, ECR images/repository, log groups, alarms and lab-only IAM/network
resources. Delete any ALB/listeners/target groups, NAT gateways and allocated IPs
you added. Check every region used and review billing after usage has appeared.

### F. RDS and production data decisions

Complete SQL/index/transaction exercises in local PostgreSQL first. Review RDS
subnet groups, security groups, backups/PITR, Multi-AZ vs read replicas, pooling,
connection limits, migrations and RDS vs Aurora vs DynamoDB.

If a vacancy needs hands-on RDS or you want to close that gap now, create one small
PostgreSQL instance, connect from a permitted client such as the Fargate task,
execute a query/transaction, and delete the lab afterwards. Keep the database
private; allow its port from the application's security group and provide its
credentials securely. Do not open PostgreSQL to the internet for convenience.

This live RDS exercise is optional for the first interview pass; the architecture
explanation and local SQL proof are required. Record that distinction honestly.
Cleanup includes the instance and any retained snapshots/backups, secret, and
lab-only networking. Stopping an instance is not complete cleanup.

## Close each exercise

Explain: why this service, how it is accessed securely, scaling limits, what failed,
where you observed it, one alternative, and what you deleted. Keep notes to a few
lines and preserve only reusable code/templates in `labs/aws/<concept>/`.

Know conceptually: regions/AZs, VPC/subnets/routes/security groups, EC2 vs Fargate vs
Lambda, ALB vs API Gateway, SNS/EventBridge, KMS, backups, RTO/RPO, canary/blue-green.
Build deeper only when a target role or failed interview question calls for it.

## Official references

- [IAM best practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)
- [AWS Budgets](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html)
- [HTTP API with Lambda](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop.html)
- [S3 access through CloudFront](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html)
- [DynamoDB getting started](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GettingStartedDynamoDB.html)
- [Lambda with SQS](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html)
- [Fargate getting started](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/getting-started-fargate.html)
- [ECS container health checks](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/healthcheck.html)
- [RDS PostgreSQL getting started](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_GettingStarted.CreatingConnecting.PostgreSQL.html)
