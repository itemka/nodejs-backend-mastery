# Release notes template

Use this one-screen template for user-facing release communication.

```markdown
# Release Notes: <Area> — <Version or Date>

<In 1–2 sentences, summarize what changed and why it matters to users.>

## Key Updates

### <Outcome-focused update title>

- **What changed:** <User-visible change.>
- **Why it matters:** <Supported user outcome or benefit.>
- **Limitations:** <Known limitation, or omit this line.>

## Known Issues

<!-- Optional. Remove this section if there are no known issues. -->

- <Known issue and practical workaround, if any.>

Questions? <Point readers to the appropriate support or project channel.>
```

## Rules

- Write outcome-focused titles instead of implementation summaries.
- Include only merged, completed work.
- Never invent business impact, benefits, or timelines.
- Exclude PR IDs, branch names, and internal or security-sensitive details.
- Group related changes into one entry.
- Require human approval before publishing.

## Example

- **Bad:** `- Fix payment bug`
- **Good:** `- Customers can now complete card payments without timeout errors (previously the payment form could time out at checkout).`

Prepared by the [delivery role](../../.agents/agents/delivery.md). Use [pr-description](../../.agents/skills/pr-description/SKILL.md) for reviewer-facing PR text instead.
