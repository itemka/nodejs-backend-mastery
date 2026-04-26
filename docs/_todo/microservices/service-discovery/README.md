# Service discovery

**Category:** microservices · **Primary app:** — · **Prereqs:** microservices · **Status:** todo

## Scope
- DNS-based (ECS Service Connect, Kubernetes DNS, Consul DNS).
- Registry-based (Consul, etcd, Zookeeper).
- Client-side vs server-side discovery.
- Health checks that drive discovery.

## Sub-tasks
- [ ] Note which ECS Service Connect features cover discovery + load balancing natively.
- [ ] Write a short comparison vs manual ALB target groups.

## Concepts to know
- DNS TTLs can lag; health checks need to remove bad nodes fast.
- Mesh (Envoy sidecar) can take discovery + retries off the app.
- For N<10 services, a static config or load balancer URL is often enough.

## Interview questions
- When do you need service discovery beyond DNS + a load balancer?
- Client-side vs server-side discovery — trade-offs?
- How does a mesh change the discovery story?
