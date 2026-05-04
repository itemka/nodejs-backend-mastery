# AI Agents

Shared AI-agent toolkit for Codex, Claude Code, Cursor, and any other tool that
honors `AGENTS.md`. Keep portable material here. Add tool-specific adapters
under `.codex/`, `.claude/`, `.cursor/`, or `.github/` only when a tool needs
its own file format.

Root entry points stay thin:

- [../AGENTS.md](../AGENTS.md) points agents into this folder.
- [../CLAUDE.md](../CLAUDE.md) imports `AGENTS.md` for Claude Code.

## What Belongs Here

- Cross-tool always-on rules.
- Reusable workflows for planning, coding, testing, review, docs, debugging,
  refactoring, commits, and PRs.
- Portable role specs used by specialist or worker agents.
- Compact review checklists.

## What Does Not Belong Here

- Secrets, tokens, API keys, credentials, private URLs, or machine-specific paths.
- Product or learning docs — use [../docs/](../docs/).
- Long duplicated tool configs — keep adapters short and link back here.
- Temporary scratch plans that should live in an issue, PR, or local note.

## Folder Map

- [rules/](./rules/) — Small always-on instructions that every AI tool should
  follow before editing the repo. Keep these concise because they are likely
  to be loaded often.
- [skills/](./skills/) — Canonical reusable workflows for development tasks
  such as planning, implementation, debugging, validation, review, docs,
  commits, hooks, and MCP decisions. Put durable step-by-step guidance here
  first.
- [agents/](./agents/) — Optional specialist role specs used for focused
  review or thinking, such as backend architecture, security, testing,
  delivery, or documentation. Keep agents thin and link them from relevant
  skills instead of duplicating workflows.
- [commands/](./commands/) — Short runnable prompts that start common
  workflows and route to the right skills. Commands should not contain full
  procedures; they are entry points, not sources of truth.
- [checklists/](./checklists/) — Compact verification criteria used by
  skills and reviewers. Keep checklists practical, scannable, and free from
  long explanations.

## AI-Agent Guidance Rule

`.agents/skills/` is the canonical home for reusable workflows. `.agents/commands/`
and `.agents/agents/` are routing layers — they should point into skills and
checklists rather than duplicate workflow content. The same principle applies to
tool-specific adapters under `.claude/`, `.codex/`, `.cursor/`, and `.github/`:
keep adapters thin and link back to the portable source.

When a workflow lives inside a command, role spec, or tool adapter, move the
durable content into the matching skill first and make the adapter point to it.

When a role spec under [agents/](./agents/) is useful for a workflow, link it
from the related skill in a short `Related Role Specs` section. Role specs are
not always-loaded context.

When adding or renaming a skill, keep the folder name equal to the frontmatter
`name`, update this index, and add or update any required tool-specific thin
adapters such as `.claude/skills/<name>/SKILL.md`.

Hooks and MCP guidance belong in [skills/designing-hooks/](./skills/designing-hooks/)
and [skills/configuring-mcp/](./skills/configuring-mcp/). Create `.agents/hooks/`
only when concrete reusable hook scripts or adapters need a portable home.

## Tool Adapter Map

- **Codex** — root `AGENTS.md` is the project instruction surface; project-
  scoped Codex config (hooks, MCP, custom agents) lives under `.codex/`.
- **Claude Code** — `CLAUDE.md` imports `AGENTS.md`; thin adapters live under
  `.claude/skills/<name>/SKILL.md`, `.claude/agents/*.md`, and
  `.claude/commands/*.md`. Skills take precedence when names collide with
  legacy command files.
- **GitHub Copilot** — `AGENTS.md` is supported as repo instructions; Copilot-
  specific prompts and agents belong under `.github/`.
- **Cursor** — `AGENTS.md` is supported as plain instructions; scoped rules,
  commands, and MCP config belong under `.cursor/`.

Treat tool-specific adapters as thin pointers into `.agents/`. Do not copy
skill bodies into adapter files.

## Source Priority

Use official product docs as the source of truth for tool-specific file
locations and behavior:

- Agent Skills open standard: <https://agentskills.io/specification>
- Agent Skills best practices (open spec): <https://agentskills.io/skill-creation/best-practices>
- Claude Code: <https://code.claude.com/docs>
- Claude Code skills: <https://code.claude.com/docs/en/skills>
- Claude Code subagents: <https://code.claude.com/docs/en/subagents>
- Claude Skill authoring best practices (vendor): <https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices>
- OpenAI Codex: <https://developers.openai.com/codex>
- Cursor rules and AGENTS.md: <https://docs.cursor.com/context/rules-for-ai>
- AGENTS.md standard: <https://agents.md>

When refreshing AI-agent guidance, also scan official changelogs, release
notes, and dated best-practice pages. The recency-window rule for that
refresh is owned by [skills/update-docs/SKILL.md](./skills/update-docs/SKILL.md);
do not duplicate it elsewhere.

### Secondary Skill-Guidance Sources

Use these when the recency scan is insufficient, or when reviewing skill
structure, best practices, or agent patterns more broadly. Treat the Agent
Skills open standard as a portable-format reference; treat community examples
as secondary context. Cross-check any guidance against official vendor docs
before adopting it.

- Agent Skills open standard best practices: <https://agentskills.io/skill-creation/best-practices>
- Community examples: <https://github.com/obra/superpowers/tree/main>
- Community examples: <https://github.com/addyosmani/agent-skills/>
- Community directories: <https://skills.sh/>
- Community directories: <https://mcp.directory/skills>

## Reuse In Another Project

1. Copy `.agents/` into the target repo.
2. Rewrite [rules/repo-map.md](./rules/repo-map.md) for that repo's layout,
   commands, and production boundaries.
3. Keep [rules/project.md](./rules/project.md), skills, agents, commands, and
   checklists mostly generic.
4. Add a thin root `AGENTS.md` that links to this folder and the rule files.
5. Add tool-specific adapters only when needed.

Keep project-specific details in `rules/repo-map.md`. Keep reusable workflows
generic.
