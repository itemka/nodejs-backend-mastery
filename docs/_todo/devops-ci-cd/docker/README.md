# Docker

**Category:** devops-ci-cd · **Primary app:** [shop-mvc-express](../../../../workspaces/apps/shop-mvc-express/) · **Prereqs:** — · **Status:** todo

## Scope

- Multi-stage builds; builder + runtime images.
- Slim base images (distroless, `node:*-slim`) and non-root user.
- Layer caching; lockfile-first to maximize cache hits.
- Docker Compose for local Postgres + Redis.
- Single-VM deployment with Docker Compose on EC2 or a VPS.
- Security: no secrets in layers, pin versions, scan with Trivy.

## Sub-tasks

- [ ] Write a multi-stage Dockerfile for shop-mvc-express (build stage + runtime).
- [ ] Run as non-root; drop Linux capabilities where possible.
- [ ] Author `docker-compose.yml` with Postgres + Redis + app for local dev.
- [ ] Run the compose stack on a single EC2/VPS host; document env, ports, volumes, and restart policy.
- [ ] Add `.dockerignore` to keep build context small.
- [ ] Scan the image with Trivy in CI; fail on HIGH severity.

## Concepts to know

- Reorder Dockerfile so lockfile + deps land before app source — cache wins.
- `CMD` vs `ENTRYPOINT`; signal forwarding for graceful shutdown (use `tini` or exec form).
- Healthchecks: Docker-level only helps docker-compose; for ECS use the task definition.
- Image size matters for pull latency during scale-out.
- Single-host deploys are useful for learning; ECS takes over once you need managed rollout and scaling.

## Interview questions

- Walk through your multi-stage Dockerfile.
- Why run as non-root? How do you make it work with bind mounts?
- Why is the order of `COPY` statements load-bearing?
- How does the container receive SIGTERM? What do you do with it?
- Docker Compose on a VPS vs ECS Fargate — what changes operationally?
