# Service meshes

**Category:** architecture-patterns · **Primary app:** — · **Prereqs:** microservices · **Status:** todo

## Scope

- Sidecar proxies (Envoy) and control-plane (Istio, Linkerd, Consul).
- What the mesh takes off the application: mTLS, retries, timeouts, circuit breaking, routing.
- Observability: out-of-the-box metrics, traces, access logs.
- Cost: extra hop, ops complexity, learning curve.

## Sub-tasks

- [ ] Write a short note on when a mesh pays off (~10+ services, multi-tenancy, compliance).
- [ ] Compare application-library stability patterns vs mesh-provided ones.

## Concepts to know

- mTLS at the mesh removes cert handling from apps.
- Traffic shifting enables canary and blue-green with declarative policy.
- Not a substitute for good service contracts — a mesh cannot fix bad APIs.

## Interview questions

- When would you reach for a service mesh?
- Explain mTLS at the mesh — what's the app not doing anymore?
- Trade-offs: library-side resilience (opossum, retry helpers) vs mesh-side.
