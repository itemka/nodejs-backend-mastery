---
name: grill-me
description: Interrogate an idea, requirements, architecture, or implementation plan when the user asks to be grilled, challenged, or to stress-test a proposed solution. Expose assumptions, risks, missing requirements, and unresolved decisions through focused questioning. Keep the session read-only.
license: MIT
metadata:
  created: '2026-10-20'
  status: 'pilot'
  portability: 'cross-tool'
  last-reviewed: '2026-10-20'
---

# Grill Me

## Purpose And Scope

Reach a shared understanding by challenging a proposed idea or solution before acting on it.
Use on demand when the user requests interrogation; do not make this a prerequisite for
ordinary tasks, brainstorming, planning, or implementation.

- [brainstorm](../brainstorm/SKILL.md) explores ideas and compares possible solutions.
- `grill-me` tests a proposal for hidden assumptions, missing requirements, and weak decisions.
- [plan](../plan/SKILL.md) turns sufficiently clear requirements into implementation steps.

These are separate workflows, not required stages or dependencies.

## Inputs

Use the user's proposal and relevant conversation, requirements, repository evidence, and
constraints. If there is no identifiable proposal, first ask what the user wants challenged.
Keep the scope proportional to the proposal and its consequences.

## Workflow

1. Briefly restate the proposal, intended outcome, and known constraints. Inspect relevant
   repository context with available read-only tools before asking questions it can answer.
   Finding facts is the agent's job; choosing between trade-offs is the user's. If a fact
   cannot be verified, label it unknown and ask only for information unavailable to you.
2. Map the important uncertainties as a **decision tree**: each decision can unlock others.
   Track settled decisions, explicit assumptions, deferred risks, and unresolved prerequisites
   in the conversation. An investigation still in progress is an unresolved prerequisite;
   continue with independent questions while dependent ones wait.
3. Challenge the branches that could change the outcome: purpose and success criteria,
   requirements and non-goals, evidence behind assumptions, simpler alternatives, and relevant
   architecture or implementation risks. Use concrete counterexamples and failure scenarios
   to test claims. Inspect boundaries, ownership, compatibility, recovery, or validation where
   they matter; avoid speculative branches and checklist-driven interrogation.
4. Work in **rounds**. The **frontier** contains the meaningful unanswered decisions whose
   prerequisites are settled. Ask these independent questions together, numbered, with a short
   title and your recommended answer plus its reason or material trade-off. Word each so that
   "yes" accepts the recommendation; make alternatives easy to choose. For example:

   > **Q1 — Duplicate delivery:** Shall we require repeated deliveries of the same event to
   > produce only one side effect?
   > Recommendation: Yes; retries must not repeat a charge or notification.

   Use a question UI when available and suitable, or plain text. If its limits prevent a full
   round, present the independent questions in text. No particular tool is required.

5. Wait for the user's answers before the next round. Recompute the tree from those answers,
   investigate newly relevant facts, and resolve newly unblocked questions. Never ask a
   question that depends on another unanswered question in the same round. Do not repeat
   answered questions unless new evidence contradicts them; explain why when reopening one.
   Partial answers and silence leave the other decisions open, not accepted by default.
6. Continue until the frontier is empty or the user explicitly stops.
   Do not manufacture questions to prolong the session. A user-deferred issue stays visible
   as an open question or accepted risk; it is not a resolved decision. If progress depends
   on unavailable evidence, state the blocker instead of inventing an answer or looping.
7. Summarize in chat: decisions and rationale, assumptions and their evidence, trade-offs,
   remaining risks, and open questions or blockers. When the uncertainties are resolved,
   ask the user to confirm the shared understanding. If the user stops early, summarize the
   partial result without another round. Do not claim agreement before it is confirmed.

## Boundaries

- Keep execution read-only: no implementation, file edits, plan artifacts, or external writes.
  Confirmation of shared understanding is not permission to implement. Move to another
  workflow only when the user separately requests that work.
- Respect repository instructions, permissions, and safety rules during fact-finding.
- Challenge the proposal constructively. Explain why each question matters rather than
  interrogating for its own sake or substituting your preferences for the user's decisions.

## Attribution

Adapted from Matt Pocock's MIT-licensed
[`grill-me`](https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/skills/productivity/grill-me/SKILL.md)
and
[`grilling`](https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/skills/productivity/grilling/SKILL.md),
reviewed at commit `5beb35b040e3de97e54fa9e386d7e42d15c295c2` (repository version `1.3.1`).
The entry point and interview workflow are combined here; fact-finding uses available tools
directly instead of requiring delegation. The upstream copyright and permission notice are
preserved in [LICENSE](./LICENSE).
