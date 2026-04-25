# DynamoDB (single-table design)

**Category:** data-storage/nosql · **Primary app:** [serverless-toolkit](../../../../../workspaces/apps/serverless-toolkit/) · **Prereqs:** — · **Status:** todo

## Scope
- Partition key + sort key design; access-pattern-first modeling.
- GSI / LSI; projection trade-offs.
- On-demand vs provisioned capacity; auto-scaling.
- Streams for CDC-style consumers.
- TTL for expiring rows.

## Sub-tasks
- [ ] List the access patterns for one feature (e.g. notes) before designing the table.
- [ ] Design a single-table schema with `PK`, `SK`, one GSI, and a TTL attribute.
- [ ] Implement CRUD via Lambda with the AWS SDK v3.
- [ ] Wire a DynamoDB stream → Lambda projection for downstream reads.

## Concepts to know
- Single-table design packs multiple entity types into one table with composite keys.
- Hot partitions kill throughput; design keys to spread writes.
- Scans are last resort; always access by key or GSI.
- Global tables cost money and add conflict-resolution complexity.

## Interview questions
- Partition key for a `chat_messages` table — pick and justify.
- How do you model a 1-to-many relationship in DynamoDB?
- When do you pick DynamoDB over Postgres?
- Explain hot partitions and how to avoid them.
