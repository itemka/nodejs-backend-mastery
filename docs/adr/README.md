# Architecture Decision Records

Architecture Decision Records (ADRs) preserve the reasoning behind consequential repository
choices. Keep each ADR short, evidence-based, and linked from this index.

## Index

| Number | Decision                                                             | Status   | Date       |
| ------ | -------------------------------------------------------------------- | -------- | ---------- |
| 0001   | [Architecture-as-code format](./0001-architecture-as-code-format.md) | Proposed | 2026-07-15 |
| 0002   | [API contract generation](./0002-api-contract-generation.md)         | Proposed | 2026-07-22 |

## When An ADR Is Required

Write an ADR when a lasting decision answers yes to any of these questions:

- Is it hard or costly to reverse?
- Does it affect more than one system or team?
- Does it constrain how the rest of the system must be built?

Skip routine implementation details whose rationale is already clear from the code.

## Format

- Name files `NNNN-kebab-title.md` with a zero-padded, increasing number.
- Never renumber an ADR, including after it is superseded.
- Open with a header block of `Status`, `Decision date` (when the choice was made), and
  `Recorded` (when this file was written — the same day unless the record is retrospective).
- Include five sections: `Context`, `Decision`, `Consequences`, `Alternatives`, and
  `Compliance`.
- Cite repository evidence and identify retrospective records explicitly.
- Add an index row carrying the ADR's `Decision date`, and change `Status` in the ADR file and
  its index row together.

## Writing An ADR

- Fill in the ADR **while the decision is being made**, not after it ships. Capture the
  reasoning and alternatives weighed, not only the outcome; retrospective records are allowed
  but lossy and must say so.
- Record the **least bad trade-off for this repository right now**, including its costs; there is
  no universally right answer.
- Use AI for **questions, options, and risks—never for the decision**. Ask what must be answered
  first, compare three or four realistic options with honest trade-offs, and attack the chosen
  option.
- Before proposing acceptance, have the decision **attacked in a fresh session** that receives
  the shared context but not the prior reasoning thread. Fold findings into `Consequences` or
  change the decision; stop when a fresh attack finds no new significant risks, not at zero risk.

## Status

The lifecycle is `Proposed` → `Accepted` → `Superseded by NNNN`. An ADR remains `Proposed`
until a human has read it and confirmed that it accurately records the decision and trade-offs.

Every `Proposed` row in the index is therefore an open review action, not a finished record. The
index is the tracker — no separate follow-up list is needed.
