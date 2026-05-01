# S3 + CloudFront

**Category:** cloud-services/aws · **Primary app:** [media-service](../../../../../workspaces/apps/media-service/) · **Prereqs:** aws · **Status:** todo

## Scope

- S3 storage classes, lifecycle rules.
- Presigned URLs for direct upload/download.
- Access control: bucket policy vs ACL vs Origin Access Control (OAC).
- CloudFront: origins, behaviors, cache policies, signed URLs/cookies.
- Lambda@Edge / CloudFront Functions for header manipulation.

## Sub-tasks

- [ ] Issue presigned PUT URLs so the client uploads directly to S3.
- [ ] Put CloudFront in front of S3 using Origin Access Control; block direct bucket access.
- [ ] Set long `Cache-Control` on fingerprinted assets; short on dynamic.
- [ ] Process uploaded images with a Lambda triggered from S3 events.

## Concepts to know

- Presigned URLs encode the requester's identity + expiration.
- Public buckets are a common leak — default-deny at the account level.
- CloudFront Functions beat Lambda@Edge for simple header rewrites (cheaper, lower latency).

## Interview questions

- Design a scalable upload flow. Where does the client send bytes?
- Explain OAC vs the legacy OAI pattern.
- How do you serve private files through CloudFront?
