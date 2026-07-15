# Media Service (Uploads & Streaming)

**Status:** deferred brief — not in the committed app order. The S3/CloudFront
upload + CDN scope is absorbed by `serverless-toolkit` (Phase 6). Revisit the
ffmpeg/HLS transcoding scope only if it earns its own phase.

- Why: files are everywhere.
- Covers: S3/MinIO uploads, presigned URLs, virus scan hook, thumbnails,
  video transcode to HLS (ffmpeg), range requests, CDN headers.
- Stack: S3/MinIO, ffmpeg worker (BullMQ), Postgres for metadata.
- Arch: feature-based with background jobs.
- Stretch: multi-part uploads, resumable uploads, object-lifecycle policies.

## Deployment (sketch)

- Target: ECS Fargate API + S3 + CloudFront; SQS/Lambda for ffmpeg workers
- AWS: S3 (multipart, presign), CloudFront (range, cache), SQS, Lambda, ECR/ECS, CloudWatch
