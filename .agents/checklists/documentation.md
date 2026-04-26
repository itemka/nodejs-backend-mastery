# Documentation Checklist

- The documentation matches implemented behavior.
- The audience is clear: user, contributor, operator, reviewer, or maintainer.
- Setup, commands, config, API examples, migration notes, or rollback notes are included when relevant.
- Examples are concrete and can be copied or followed.
- Stale or conflicting statements were removed.
- Links point to existing files or stable external references.
- No secrets, private URLs, local absolute paths, or personal environment details are included.
- The update is scoped to the change and avoids broad unrelated rewrites.
- Root AI instruction files stay thin; detailed workflows live in skills, while commands and tool adapters stay short and route to the shared source.
- Tool-specific adapters link back to shared guidance instead of duplicating it.
- For AI-agent guidance, the `Freshness Window` and `AI-Agent Docs Review` in [skills/update-docs/SKILL.md](../skills/update-docs/SKILL.md) were followed and the recency window used was reported (or lack of docs access was stated).
- AI-agent docs match the `AI-Agent Docs Layout` (skills canonical, commands thin, agents thin role specs, checklists compact, rules short, `.claude/`/other adapters thin); deviations are flagged with a keep-or-change recommendation, not silently restructured.
- AI-agent docs were scanned for duplicated guidance, stale links, stale references to removed/renamed surfaces, and overgrown files.
