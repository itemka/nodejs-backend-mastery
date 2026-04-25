# Update Documentation

## Purpose

Document real behavior, workflows, APIs, migrations, and decisions with concise, accurate updates.

## When To Use

- A change affects setup, API usage, configuration, migration steps, examples, or contributor workflow.
- A PR needs docs updated before review.
- Existing docs conflict with current code.

## Inputs

- Current diff or implemented behavior.
- Existing docs, README files, examples, commands, and templates.
- Validation output, screenshots, API examples, or migration notes when relevant.

## Use With

- [update-docs skill](../skills/update-docs/SKILL.md)
- [update-docs command](../commands/update-docs.md)
- [documentation checklist](../checklists/documentation.md)
- [architecture-decision template](../prompts/architecture-decision-template.md)

## Review Or Work Steps

1. Identify the target audience.
2. Inspect the code and existing docs before writing.
3. Update the smallest relevant docs surface.
4. Prefer concrete examples, commands, and file references.
5. Remove stale or conflicting content.
6. Report docs changed and any intentional gaps.

## Output Format

- Docs updated.
- Behavior or workflow documented.
- Examples or migration notes added.
- Source or validation checked.
- Remaining docs gaps.

## Boundaries

- Do not document behavior that was not implemented or verified.
- Do not include secrets, local paths, private URLs, or environment-specific values.
- Do not rewrite unrelated docs.
