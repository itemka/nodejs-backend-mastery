# Event bus (Kafka / SNS+SQS)

**Category:** microservices · **Primary app:** — · **Prereqs:** event-driven · **Status:** todo

## Scope
- Kafka topics, partitions, consumer groups, offsets.
- Delivery semantics: at-least-once default; exactly-once with idempotent producer + transactions (within Kafka only).
- SNS fan-out + SQS consumer queues as a simpler AWS-native alternative.
- When managed (MSK / Confluent) beats self-hosted.

## Sub-tasks
- [ ] Write a short note comparing Kafka vs SNS+SQS vs EventBridge for shop + orders events.
- [ ] Sketch partitioning for a `orders.events` topic (partition key choice, ordering guarantees).

## Concepts to know
- Partition = unit of parallelism and ordering. Pick the key carefully.
- Consumer group rebalancing stalls consumption briefly — design for it.
- Retention is time-based by default; compact topics for "latest value per key".
- Backpressure: slow consumers lag; monitor lag, alert before it hits retention.

## Interview questions
- Kafka vs SNS+SQS — decision framework.
- What does a partition key give you, and how do you pick one for orders?
- Explain consumer group rebalancing and why it causes latency spikes.
- When is Kafka's exactly-once guarantee useful, and what's its catch?
