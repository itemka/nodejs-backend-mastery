# Kubernetes (EKS)

**Category:** devops-ci-cd · **Primary app:** — · **Prereqs:** docker · **Status:** todo

## Scope

- Pods, Deployments, Services, Ingress.
- ConfigMaps, Secrets, ServiceAccounts + IRSA on EKS.
- HPA, PDB, resource requests/limits.
- Helm chart structure; Kustomize overlays.
- Operators for stateful workloads.

## Sub-tasks

- [ ] Port one shop service to a local kind cluster; author a minimal Helm chart.
- [ ] Add liveness + readiness probes that match the app's `/health` and `/readiness`.
- [ ] Document when EKS earns its complexity vs ECS Fargate.

## Concepts to know

- Requests drive scheduling; limits enforce at runtime.
- Readiness failures remove the pod from the Service; liveness failures kill it.
- IRSA binds a K8s ServiceAccount to an IAM role without static keys.
- PDBs prevent all replicas from being evicted simultaneously.

## Interview questions

- Kubernetes vs ECS Fargate — decision framework.
- Explain requests vs limits and what happens when each is exceeded.
- How does IRSA work on EKS?
- Rolling vs blue-green deploys in Kubernetes.
