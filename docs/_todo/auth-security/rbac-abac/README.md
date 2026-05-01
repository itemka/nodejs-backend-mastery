# RBAC / ABAC

**Category:** auth-security · **Primary app:** [auth-service](../../../../workspaces/apps/auth-service/) · **Prereqs:** jwt · **Status:** todo

## Scope

- RBAC: users → roles → permissions.
- ABAC: policy evaluates attributes of user, resource, action, environment.
- Where to enforce: at the gateway, at the service, at the resource.
- Policy-as-code (OPA / Cedar) as the step beyond hand-rolled ABAC.

## Sub-tasks

- [ ] Model `roles` and `permissions` in auth-service; seed `admin` and `user`.
- [ ] Expose `requirePermission('products:write')` middleware for other services to consume.
- [ ] Put role claim in access JWT; re-check permission server-side on sensitive routes.
- [ ] Document where each enforcement point lives in this file.

## Concepts to know

- Don't scatter `if (role === 'admin')` across the codebase — central predicate.
- Role in JWT lags reality — re-check from DB for privileged operations.
- ABAC is more flexible but harder to reason about; pick when policies depend on resource attrs.
- Least privilege: default-deny, grant explicitly.

## Interview questions

- Design RBAC for a multi-tenant shop.
- Where does the authorization decision live? Why there?
- RBAC vs ABAC — when is the added flexibility worth it?
- Token says role=admin but the user was demoted 1 second ago. What do you do?
