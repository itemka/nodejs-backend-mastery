# GDPR

**Category:** compliance-governance · **Primary app:** [shop-feature-fastify](../../../../workspaces/apps/shop-feature-fastify/) · **Prereqs:** — · **Status:** todo

## Scope
- Data subject rights: access, rectification, erasure, portability, objection.
- Lawful basis for processing; consent management.
- Data retention, minimization, and purpose limitation.
- Breach notification timelines.

## Sub-tasks
- [ ] Document what personal data the shop stores and why.
- [ ] Implement "download my data" and "delete my account" endpoints.
- [ ] Define retention policy per data type; automate expiry.
- [ ] Note the breach notification SLA (72 hours to authority).

## Concepts to know
- "Legitimate interest" is a valid basis but requires a balancing test.
- Soft delete vs hard delete: erasure requests usually need hard.
- Backups + GDPR are thorny — document your practical approach.

## Interview questions
- User invokes right to erasure. Walk through the steps your system takes.
- How do you keep backups GDPR-compliant?
- Lawful basis options — when is consent the wrong choice?
