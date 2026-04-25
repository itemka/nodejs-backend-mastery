# Documentation Checklist

- The documentation matches implemented behavior.
- The audience is clear: user, contributor, operator, reviewer, or maintainer.
- Setup, commands, config, API examples, migration notes, or rollback notes are included when relevant.
- Examples are concrete and can be copied or followed.
- Stale or conflicting statements were removed.
- Links point to existing files or stable external references.
- No secrets, private URLs, local absolute paths, or personal environment details are included.
- The update is scoped to the change and avoids broad unrelated rewrites.
- Root AI instruction files stay thin; detailed workflows live in skills, while commands and prompt templates stay as short adapters or user-input helpers.
- Tool-specific adapters link back to shared guidance instead of duplicating it.
- AI-agent docs were checked against current official sources during the run, or the lack of docs access is stated.
