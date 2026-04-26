# MongoDB

**Category:** data-storage/nosql · **Primary app:** — · **Prereqs:** — · **Status:** todo

## Scope
- Document modeling: embed vs reference.
- Indexes (single, compound, text, TTL).
- Aggregation pipeline.
- Transactions (replica set required) and their cost.
- Sharding key selection.

## Sub-tasks
- [ ] Model the shop domain in Mongo as an exercise; note where references beat embedding.
- [ ] Write a note comparing Mongo vs Postgres for JSON-heavy workloads.

## Concepts to know
- Embed for containment + read-together; reference when children are independent or large.
- 16MB document size limit.
- Shard key is one-way — changing it is expensive.
- Transactions work but are noticeably slower than the single-document atomic write path.

## Interview questions
- Embed vs reference — decision framework.
- How does Mongo's aggregation pipeline compare to SQL?
- When would you pick Mongo over Postgres + JSONB?
- How do you pick a shard key?
