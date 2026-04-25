# CDN caching strategies

**Category:** data-storage/caching · **Primary app:** [media-service](../../../../../workspaces/apps/media-service/) · **Prereqs:** redis · **Status:** todo

## Scope
- Edge caching via CloudFront / Cloudflare / Fastly.
- Cache-Control, ETag, surrogate keys, revalidation.
- Stale-while-revalidate and stale-if-error.
- Purge strategies: invalidate by URL, tag, or wildcard.

## Sub-tasks
- [ ] Put CloudFront in front of S3 for product images; restrict origin access.
- [ ] Set `Cache-Control` aggressively for immutable assets (fingerprinted URLs).
- [ ] Write a short note on purge strategy: event-driven vs scheduled.

## Concepts to know
- Fingerprinted URLs (`image.abcdef.jpg`) sidestep invalidation.
- Dynamic HTML at the edge is possible but costs correctness if you cache auth'd content.
- Vary headers expand cache cardinality — use deliberately.

## Interview questions
- Design the caching layers for a media-heavy e-commerce site.
- ETag vs Last-Modified — when each?
- How do you invalidate a CDN when a product image is replaced?
