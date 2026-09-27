# ADR-0004: Path-Scoped Claude Rules (Pilot)

- **Status:** Proposed
- **Decision date:** 2026-09-17
- **Recorded:** 2026-09-17

## Context

The always-on entry surface — [AGENTS.md](../../AGENTS.md), [CLAUDE.md](../../CLAUDE.md),
[`.agents/README.md`](../../.agents/README.md), and the three files in
[`.agents/rules/`](../../.agents/rules/) — was 340 lines and roughly 21 KB before this change,
loaded in full before any skill, checklist, or source file. Part of it applies to a minority of
sessions:
[change-discipline.md](../../.agents/rules/change-discipline.md) names three generated artifacts
by path, and [repo-map.md](../../.agents/rules/repo-map.md) carries per-workspace and per-command
detail across 108 lines.

A 2026-09-17 review of certification material against this repository surfaced one piece of
guidance with no viable home: how Claude Code itself behaves when a workflow drives it — print
mode versus `--bare`, the JSON envelope and `--json-schema`, replace versus append system-prompt
flags, and why a review run must be a separate invocation from the run that produced the change.
It matters
only while editing [`.github/workflows/`](../../.github/workflows/); an always-on rule would
charge every session for it, and a skill would never be reached by someone editing YAML. (The
other homeless item from the same review, synchronous versus batch Anthropic API processing, went
to [improve-token-usage](../../.agents/skills/improve-token-usage/SKILL.md) § _Processing Mode_,
which [ADR-0003](./0003-ai-agent-surface-promotion-bar.md) already names as the home for cost and
model routing.)

Claude Code supports `.claude/rules/*.md` with a YAML `paths` list; a rule so scoped enters
context only when Claude reads a matching file, and a rule without `paths` loads at launch with
the same weight as `.claude/CLAUDE.md` (verified against the official memory documentation on
2026-09-17). [ADR-0003](./0003-ai-agent-surface-promotion-bar.md) treats a vendor pattern as a
candidate and never a trigger, so the existence of the mechanism is not the justification here —
the unhoused guidance is.

## Decision

Adopt `.claude/rules/` as a **time-boxed pilot** at the narrowest viable scope: exactly one rule,
[`.claude/rules/claude-code-ci.md`](../../.claude/rules/claude-code-ci.md), scoped to
`.github/workflows/**`.

Pilot constraints:

- **One rule.** A second one waits for the review below.
- **Every rule declares `paths`.** A rule without `paths` is an always-on surface and faces
  ADR-0003 in full, at always-on cost.
- **Nothing migrates out of `.agents/rules/` during the pilot.** Moving a universal standard
  behind a glob silently drops it from every session the glob does not match; that risk is not
  what is being tested here.
- **Rules stay thin.** They hold the trigger and the few product facts that must be in context,
  within the line limit enforced by [`scripts/check-adapters.mjs`](../../scripts/check-adapters.mjs),
  and link to `.agents/` for anything durable.
- **Claude-only.** Codex and Cursor do not read `.claude/rules/`, so nothing a non-Claude agent
  must know belongs here.

Review by **2026-12-17**: keep, extend, or delete.

## Consequences

- Guidance that was previously unwritten has a home that costs nothing until it is relevant.
- A rule that stops matching fails silently — it is invisible rather than wrong. `/context` and
  the `InstructionsLoaded` hook are the only ways to see whether it loaded, so "it is in the
  repository" stops being evidence that an agent read it.
- Claude and Codex now diverge on the same file: a Codex session editing a workflow does not see
  this content. Anything that must hold for every tool stays in `.agents/`.
- A second surface class raises the cost of the next structural review, which is exactly what
  ADR-0003 exists to resist. The pilot is bounded so that cost is reversible.
- If the pilot ends in deletion, the content returns to being unhoused; that outcome should be
  recorded here rather than quietly re-litigated.

## Alternatives

- **An always-on rule in `.agents/rules/`** — rejected: charges every session for content that
  applies while editing three YAML files.
- **A skill** — rejected: skills load on invocation or intent match, and nobody invokes a skill to
  edit a workflow file.
- **A section in `repo-map.md` § _Config And CI_** — rejected: same always-on cost, and repo-map
  is repository orientation, not vendor product behavior.
- **Leaving it in the certification notes** — rejected: that is the state this review was run to
  end.
- **A portable body under `.agents/` with a thin `.claude/rules/` pointer** — rejected for this
  pilot: the content is Claude Code product behavior, so the portable copy would have no other
  consumer, and a pointer rule would still require Claude to follow a link to get the facts.
  Revisit if a rule appears whose content is genuinely cross-tool.

## Compliance

ADR-0003 criteria, stated as they actually stand at adoption:

- **Repetition:** one. This is the first instance, which is why it is a pilot rather than an
  adoption — per ADR-0003 a pilot generates the missing repetitions, it does not skip them.
- **Trigger:** Claude reads a file under `.github/workflows/**`.
- **Contract:** input is the matching file; output is in-context CI conventions; home is
  `.claude/rules/<topic>.md`; no existing surface carries this content.
- **Validation:** `/context` lists the rule while a workflow file is in play and omits it
  otherwise. An `InstructionsLoaded` hook could log each load, but none is wired in this
  repository, so `/context` is the check actually available.
- **Review:** 2026-12-17. If the rule cannot be shown to have loaded, delete it and record that
  outcome in this ADR.
