<!-- TODO: Re-evaluate scope and approach before starting implementation. -->

# IoT/Telemetry Ingest (Time-Series)

Build them in one monorepo (`nodejs-backend-mastery`) and reuse shared packages (config/logger/errors/metrics/testing).

- Why: High-write, time-series, roll-ups.
- Covers: MQTT/HTTP ingest, validation, batching, TimescaleDB/InfluxDB, retention policies, downsampling, geospatial queries.
- Stack: Mosquitto (or AWS IoT Core), TimescaleDB/Influx, Kafka/SQS optional.
- Arch: Clean; writer/reader separation.
- Stretch: Alert rules engine + notifications.

## Deployment

- Target: AWS IoT Core → Lambda → Timestream (or Timescale/Postgres)
- AWS: IoT Core, Timestream, Kinesis Firehose/S3 (optional), CloudWatch Alarms

## CI/CD (GitHub Actions)

- Auth: OIDC to AWS
- Steps: `cdk deploy` IoT rules, Lambdas, Timestream tables; alarms & dashboards
- Extras: Retention, downsampling, backpressure and batching
