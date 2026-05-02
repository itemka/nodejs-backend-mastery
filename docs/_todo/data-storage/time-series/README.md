# Time-series

**Category:** data-storage · **Primary app:** — · **Prereqs:** postgresql · **Status:** todo

## Scope

- Timescale (Postgres extension), Influx, Prometheus (short-term).
- Downsampling / continuous aggregates.
- Cardinality control — the common failure mode.

## Sub-tasks

- [ ] Write a note on when time-series beats vanilla Postgres + `BRIN` index.
- [ ] Sketch a downsampling schedule (1s → 1m → 1h → 1d).

## Concepts to know

- Hypertables + chunks partition by time to keep inserts and range queries fast.
- High-cardinality labels explode Prometheus; keep them bounded.
- Retention policies drop old chunks; plan archival separately if you need history.

## Interview questions

- When do you pick Timescale over vanilla Postgres?
- Why is cardinality the enemy for metrics stores?
- Design retention for 2 years of metrics at 1s granularity.
