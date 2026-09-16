# Docker: learn by running this lab

Complete this before the AWS container deployment. Use two short sessions if
images, networking or volumes are new. All commands below run inside
`workspaces/apps/interview-lab`, after first-time `.env` setup from the README.

## 1. Image, container and build context

Stop the host `pnpm dev` process so port 3100 is free, then run:

```bash
docker compose --profile api up --build -d --wait
curl http://localhost:3100/health
docker compose ps
docker compose logs --tail 30 api
docker compose exec api id
```

Observe a healthy service, HTTP 200, JSON logs, and the non-root `node` user.
Read the Dockerfile: the build stage installs/compiler tools; the final stage
contains the deployed production package. The build context is the repository
root because the lockfile, workspace config and TS base config live there.

Explain: image vs container; layers/cache; `COPY`; build context; multi-stage
builds; `CMD`; `USER`; `EXPOSE` vs a published port; why secrets never enter an image.
Change the health response temporarily, rebuild, observe it, then restore it.

## 2. Networking and optional data services

```bash
docker compose --profile data up -d --wait
docker compose exec postgres psql -U lab -d interview_lab -c 'SELECT 1;'
docker compose exec redis redis-cli ping
```

The SQL command assumes the example username/database; adapt it if you changed
those values in `.env`. Expected results: one row and `PONG`.

| Client location                           | PostgreSQL       | Redis            | API              |
| ----------------------------------------- | ---------------- | ---------------- | ---------------- |
| Host, default ports                       | `localhost:5433` | `localhost:6380` | `localhost:3100` |
| Another container in this Compose project | `postgres:5432`  | `redis:6379`     | `api:3000`       |

Inside a container, `localhost` means that container. Compose service names are
DNS names on the project network. Published ports bind to host loopback only.
Redis has no password here and is for disposable local exercises.

Start only what a topic needs: `docker compose up -d --wait postgres` starts
PostgreSQL without Redis or the API. The API does not connect to either service
until you implement a data lab.

## 3. Persistence and startup behavior

1. Create a tiny table and insert a row using `psql`.
2. Run `docker compose restart postgres`; verify the row remains.
3. Stop and recreate the PostgreSQL container without removing its named volume;
   verify the row still remains.
4. Explain named volumes vs bind mounts vs the container's writable filesystem.

PostgreSQL uses a named volume. Redis uses ephemeral storage: cache loss is an
expected scenario. Changing `POSTGRES_PASSWORD` does not change an existing
database user's password inside an already initialized PostgreSQL volume.

Health checks and `--wait` help you wait for startup. `depends_on` without a
health condition only establishes startup order; applications still need to cope
with dependencies becoming unavailable later.

## 4. Stop, inspect and clean up

```bash
docker compose stop api
docker compose --profile '*' down
```

The API receives a stop signal; Nest shutdown hooks can close resources added by
future labs. Explain how a rolling deployment should stop accepting traffic and
drain work before exit. The current bootstrap has no queue or DB pool to drain.

`down` keeps the PostgreSQL volume. When you intentionally want to erase all
disposable lab data, `docker compose --profile '*' down --volumes` removes it.
Do not use broad system-wide prune commands for this exercise.

Finish by explaining a failed port binding, a bad container hostname, a lost
ephemeral cache, and why a process health endpoint differs from dependency readiness.

Primary references: [Node container guide](https://docs.docker.com/guides/nodejs/),
[multi-stage builds](https://docs.docker.com/build/building/multi-stage/),
[Compose networking](https://docs.docker.com/compose/how-tos/networking/),
[Compose startup order](https://docs.docker.com/compose/how-tos/startup-order/).
