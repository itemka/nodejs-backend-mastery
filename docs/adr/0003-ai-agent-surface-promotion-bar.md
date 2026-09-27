# ADR-0003: AI-Agent Surface Promotion Bar

- **Status:** Accepted
- **Decision date:** 2026-07-19
- **Recorded:** 2026-07-25

## Context

The [`.agents/`](../../.agents/README.md) layer carries 22 skills, 11 role specs, 9 commands, and
6 checklists, plus 3 always-loaded rules and 11 hook scripts. Learning material arrives
continuously and nearly every lecture suggests another surface; each addition is cheap to write
and permanently expensive to carry. Which suggestions were declined, and why, previously lived
only in temporary `docs/plan-*.md` files that [plan/SKILL.md](../../.agents/skills/plan/SKILL.md)
§ _Plan Artifact Policy_ keeps unstaged and uncommitted (verified 2026-07-25: no plan file has
ever landed on `main`), so the same conclusions were re-derived each round.

This is a retrospective record: the bar below has been applied since 2026-07-19 — commit
`491cb4d` piloted mutation testing report-only in a single workspace instead of adopting it
repo-wide — without being written down.

## Decision

Add a new AI-agent surface only when all of the following hold:

- **Repetition:** the workflow has been carried out in this repository 2–3 times. Ad-hoc runs by
  prompting count and are the normal way repetitions accumulate. Course material, an article, or
  a vendor pattern is a candidate, never a trigger.
- **Trigger:** a concrete, statable condition under which an agent should load it, distinct from
  the triggers of every existing surface.
- **Contract:** stated inputs and outputs, and a home that does not duplicate an existing one.
- **Validation:** an observable way to tell whether following it worked.

Where a workflow genuinely cannot be run without the surface — automation that must execute to
happen at all — the allowed path is a **time-boxed pilot**: narrowest viable scope, marked as a
pilot, with a stated date to keep or remove it (what `491cb4d` did). A pilot generates the first
repetitions; it does not skip them.

Improving an existing surface is preferred over adding one. When a candidate substantially
overlaps an existing surface, the default is to extend that surface.

The bar governs `.agents/` — skills, commands, role specs, checklists, rules, hooks, and their
tool adapters. Rules load every session and hooks execute on every matching event, so they face
the same criteria at a higher cost. Product docs, roadmap topics ([`docs/_todo/`](../_todo/)),
and templates ([`docs/templates/`](../templates/)) are exempt while they stay reference material
read on demand; a template that acquires a load trigger has become a surface.

## Consequences

- Genuinely useful patterns are adopted late: a good idea waits for repetitions that may take
  weeks to accumulate. This is the price of keeping the layer small enough to trust.
- Growth is pushed into existing files, and content bolted into a host skill whose description
  no longer advertises it becomes unfindable. An extend decision therefore re-runs
  [maintain-agent-docs](../../.agents/skills/maintain-agent-docs/SKILL.md) § _Skill Behavior
  Validation_ before it counts as done.
- This is a single-author repository: the compliance check below is a written self-check, not an
  independent reviewer gate.

## Alternatives

Standing rejections — a living list, maintained per `Compliance`. Most revisit triggers are felt
rather than detected: a recurring urge to add a rejected surface counts as its trigger firing.

| Rejected surface                    | Evidence                                                                                                                                                                                                                                                                                                                 | Revisit trigger                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `release-notes` skill               | `gh release list` returns no releases; [docs/templates/release-notes.md](../templates/release-notes.md) already carries the format                                                                                                                                                                                       | Two release notes have been written by hand                             |
| `backlog-grooming` skill            | `gh issue list --state all` returns no issues, ever                                                                                                                                                                                                                                                                      | GitHub Issues becomes a real backlog                                    |
| `status-report` skill               | No tracker, no sprint boundary, no cost or token telemetry, no audience                                                                                                                                                                                                                                                  | A real reporting cadence with real data sources exists                  |
| `ai-finops` skill                   | Model routing belongs in [improve-token-usage](../../.agents/skills/improve-token-usage/SKILL.md); dirty context already lives there, repeated work is owned by [`.agents/skills/`](../../.agents/skills/) plus this ADR, and looping is bounded by [coding-discipline](../../.agents/skills/coding-discipline/SKILL.md) | A metered AI bill that someone other than the author must account for   |
| `ai-sdlc-orchestration` skill       | Restates `plan`, `implement`, `code-review`, and `validate`; fan-out is owned by `subagent-orchestration`                                                                                                                                                                                                                | A sequencing need appears that no existing skill owns                   |
| Green/Yellow/Red review zones       | [code-review](../../.agents/skills/code-review/SKILL.md) § _Parallel Specialist Review_ routes by diff size, axis count, and needed depth; § _Pass 1 — Triage and scope_ classifies touched areas                                                                                                                        | The existing routing misroutes a real review                            |
| Definition-of-Ready entry gate      | [plan-file-template.md](../../.agents/skills/plan/plan-file-template.md) gates entry with `Goal`, `Scope And Non-Goals`, and `Context And Assumptions`, and exit with a `Done when:` per step; neither is machine-checked                                                                                                | Plans repeatedly start without a stated goal or acceptance condition    |
| `docs/reports/YYYY-MM.md` tree      | `git log` already records what was built; the only reader is the author                                                                                                                                                                                                                                                  | An audience outside this repository needs periodic reports              |
| A second AI-inventory registry file | External access — the field an AI bill of materials exists for — is already recorded per server in [docs/mcp-servers.md](../mcp-servers.md), and no `.agents/` surface reaches outside the repo on its own; [`.agents/README.md`](../../.agents/README.md) covers the categories and adapter map                         | A compliance requirement needs a per-surface field neither file carries |

Two structural alternatives were weighed:

- **One ADR per rejected surface:** not selected; each individual rejection fails
  [README](./README.md) § _When An ADR Is Required_, while the bar itself passes all three.
- **Committing plan files, or a `docs/plans/` archive:** not selected; plans are working
  documents by design, and preserving them would create a second decision record that drifts
  from `docs/adr/`. Only the durable part — the bar and its rejections — is promoted here.

## Compliance

- A change that adds a surface states its repetitions, trigger, contract, and validation in the
  PR or commit description, or states that it is a time-boxed pilot and when it will be revisited.
- [maintain-agent-docs](../../.agents/skills/maintain-agent-docs/SKILL.md) § _Structural Review_
  checks new-surface candidates against this ADR's criteria and rejection table before other
  structural work proceeds.
- A rejection whose revisit trigger fires is resolved by editing its row in place with a dated
  note; superseding this record is reserved for changing the criteria or the governed scope.
