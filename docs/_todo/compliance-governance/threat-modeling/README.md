# Threat modeling

**Category:** compliance-governance · **Primary app:** [auth-service](../../../../workspaces/apps/auth-service/) · **Prereqs:** — · **Status:** todo

## Scope

- STRIDE: Spoofing, Tampering, Repudiation, Info disclosure, DoS, Elevation of privilege.
- Data flow diagrams: actors, boundaries, trust zones.
- Lightweight formats: 1-page attack surface doc beats unused 30-page artifact.

## Sub-tasks

- [ ] Run one STRIDE pass on auth-service; identify the top 5 risks with mitigations.
- [ ] Document assets, entry points, and trust boundaries in this file.
- [ ] Re-run annually or on major architecture changes.

## Concepts to know

- Threat models age — treat them as living docs tied to the architecture.
- Focus on high-impact, realistic threats; don't chase theater.
- Tie each risk to a mitigation that's either implemented or ticketed.

## Interview questions

- Walk through a threat model for an auth service.
- STRIDE categories — name one example for each.
- How do you keep a threat model from rotting?
- A security breach is suspected. How do you contain, investigate, notify, and prevent recurrence?
