# Quarterly Reliability Report

The platform team observed several incidents during the quarter. This report
summarizes the most impactful events and the follow-up work.

## Incident INC-2023-Q4-011

On October 12 the payment gateway returned 5xx responses for fifteen minutes
after a routine deploy. The root cause was a misconfigured connection pool
limit. The team restored service by rolling back to the previous release and
later raised the pool limit. Customer impact was limited to a small number of
checkout retries.

## Database Maintenance Notes

A scheduled vacuum job ran longer than expected on October 25 and increased
read latency for analytics queries. The team paused background jobs during the
window and added a runbook entry for similar future events.

## Customer Communication

The support team published two status updates during the quarter. The first
covered the payment gateway incident. The second covered the database
maintenance window. Both included links to the public status page.
