# GCP (comparison)

**Category:** cloud-services · **Primary app:** — · **Prereqs:** aws · **Status:** todo

## Scope

- Compute: Cloud Run (containers), Cloud Functions, GKE.
- Data: Cloud SQL, Spanner, BigQuery, Firestore.
- Messaging: Pub/Sub, Tasks.
- IAM differences vs AWS.

## Sub-tasks

- [ ] Write a 1-page comparison note mapping AWS services → GCP equivalents.

## Concepts to know

- Cloud Run is the closest Fargate analog; scales to zero cheaply.
- Spanner gives global strong consistency at cost.
- Pub/Sub is a managed event bus; closer to Kafka than SNS in shape.

## Interview questions

- Cloud Run vs ECS Fargate — where does each win?
- When is Spanner worth the cost over Postgres + sharding?
