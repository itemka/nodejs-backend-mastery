<!-- TODO: Re-evaluate scope and approach before starting implementation. -->

# Media Service (Uploads & Streaming)

Build them in one monorepo (`nodejs-backend-mastery`) and reuse shared packages (config/logger/errors/metrics/testing).

- Why: Files are everywhere.
- Covers: S3/MinIO uploads, presigned URLs, virus scan hook, thumbnails, video transcode to HLS (ffmpeg), range requests, CDN headers.
- Stack: S3/MinIO, ffmpeg worker (BullMQ), Postgres for metadata.
- Arch: Feature-based with background jobs.
- Stretch: Multi-part uploads, resumable uploads, object-lifecycle policies.

## Deployment

- Target: ECS Fargate API + S3 + CloudFront; SQS/Lambda for ffmpeg workers
- AWS: S3 (multipart, presign), CloudFront (range, cache), SQS, Lambda, ECR/ECS, CloudWatch

## CI/CD (GitHub Actions)

- Auth: OIDC to AWS
- Steps: Build API image → push ECR → ECS update; deploy Lambda worker via CDK
- Extras: Signed URLs, object lifecycle policies; consider EFS or GPU tasks if needed
