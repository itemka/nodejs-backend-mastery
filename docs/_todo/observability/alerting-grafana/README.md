# Alerting (Grafana / CloudWatch)

**Category:** observability · **Primary app:** [shop-feature-fastify](../../../../workspaces/apps/shop-feature-fastify/) · **Prereqs:** metrics · **Status:** todo

## Scope
- SLO-based alerting (burn-rate alerts).
- CloudWatch alarms on ECS / ALB / RDS.
- Alert routing: PagerDuty / OpsGenie / email.
- Runbook links in every alert.

## Sub-tasks
- [ ] Add CloudWatch alarms: 5xx rate, p95 latency, ECS task restart rate, RDS CPU, Redis memory.
- [ ] Write a runbook per alert in this file (or link to an app ARCHITECTURE.md).
- [ ] Define a burn-rate alert for the SLO defined in [../metrics-prometheus/](../metrics-prometheus/).

## Concepts to know
- Symptom-based alerts (users affected) beat cause-based alerts (CPU high).
- Burn-rate alerts are fast + slow — fast catches outages, slow catches leaks.
- Every alert must be actionable, or it rots into noise.
- Paging at 3 AM for an auto-recoverable blip is a bug in the alert.

## Interview questions
- What's a good alert? What's a bad one?
- Explain SLO burn rate and design an alert pair.
- An alert fires every week and nobody acts on it. Fix the system, not the person.
