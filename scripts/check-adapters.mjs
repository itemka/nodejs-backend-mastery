// Enforce thin-adapter discipline — see .agents/README.md:
// 1. Tool-specific adapter files must stay within MAX_LINES.
// 2. Every .claude/ adapter must have a matching .agents/ source, and every
//    portable skill and agent must have a .claude/ adapter.
// 3. Path-scoped .claude/rules/ files are size-checked only — they are a
//    Claude-native surface with no .agents/ counterpart (see ADR-0004) — and
//    each must declare `paths` frontmatter so it stays conditionally loaded.
// 4. Adapters must satisfy Claude Code's discovery contract. A subagent file
//    with no `name`, or whose opening `---` is not the first line, is skipped
//    as documentation without being reported; a bad `name` or a missing
//    `description` surfaces only in the debug log. Both fail silently at
//    runtime, so they are checked here instead.
//    Reference: https://code.claude.com/docs/en/subagents

import { existsSync, readFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';

import * as ui from '@workspaces/cli-output';
import { parseDocument } from 'yaml';

const MAX_LINES = 30;

const ADAPTER_GLOBS = ['.claude/skills/**/*.md', '.claude/agents/*.md'];
const SOURCE_GLOBS = ['.agents/skills/*/SKILL.md', '.agents/agents/*.md'];
const SCOPED_RULE_GLOBS = ['.claude/rules/**/*.md'];
const AGENT_GLOBS = ['.claude/agents/*.md'];

// Parse the same YAML surface the client reads; recognizing field names alone
// would accept malformed YAML that Claude ignores at load time.
const readFrontmatter = (filePath) => {
  const text = readFileSync(filePath, 'utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (match === null)
    return { problem: 'frontmatter must open with `---` on the first line and close with `---`' };
  const document = parseDocument(match[1]);
  if (document.errors.length > 0 || document.warnings.length > 0)
    return { problem: 'frontmatter must contain valid YAML with supported tags' };
  let fields;
  try {
    fields = document.toJS();
  } catch {
    return { problem: 'frontmatter contains invalid YAML aliases' };
  }
  if (fields === null || typeof fields !== 'object' || Array.isArray(fields))
    return { problem: 'frontmatter must be a YAML mapping' };
  return { fields };
};

const scalarField = (fields, key) =>
  typeof fields[key] === 'string' && fields[key].trim() ? fields[key].trim() : null;

const ruleScopeProblem = (filePath) => {
  const { fields, problem } = readFrontmatter(filePath);
  if (problem) return problem;
  const paths = typeof fields.paths === 'string' ? fields.paths.split(',') : fields.paths;
  if (
    !Array.isArray(paths) ||
    paths.length === 0 ||
    paths.some((path) => typeof path !== 'string' || !path.trim())
  )
    return '`paths` must contain non-empty string patterns';
  return null;
};

// Mirrors the skip rules in Claude Code's subagent docs.
const agentDiscoveryProblem = (filePath) => {
  const { fields, problem } = readFrontmatter(filePath);
  if (problem) return problem;

  const name = scalarField(fields, 'name');
  if (name === null) return 'missing `name` or non-string value — expected a non-empty string';
  if (name.startsWith('-')) return `invalid \`name\` (${name}) — must not start with a hyphen`;
  if (name.includes(':')) return `invalid \`name\` (${name}) — \`:\` is reserved for plugins`;

  if (scalarField(fields, 'description') === null)
    return 'missing `description` or non-string value — expected a non-empty string';
  return null;
};

const countLines = (filePath) => {
  const text = readFileSync(filePath, 'utf8').replace(/\r?\n$/, '');
  return text === '' ? 0 : text.split(/\r?\n/).length;
};

const main = async () => {
  const oversized = [];
  const missingSources = [];
  const missingAdapters = [];
  const unscopedRules = [];
  const undiscoverable = [];

  for (const pattern of AGENT_GLOBS) {
    for await (const filePath of glob(pattern)) {
      const problem = agentDiscoveryProblem(filePath);
      if (problem !== null) undiscoverable.push(`${filePath}: ${problem}`);
    }
  }

  for (const pattern of ADAPTER_GLOBS) {
    for await (const filePath of glob(pattern)) {
      const lines = countLines(filePath);
      if (lines > MAX_LINES) oversized.push(`${filePath}: ${lines} lines`);
      const source = filePath.replace(/^\.claude\//, '.agents/');
      if (!existsSync(source)) missingSources.push(`${filePath} -> missing ${source}`);
    }
  }

  for (const pattern of SOURCE_GLOBS) {
    for await (const filePath of glob(pattern)) {
      const adapter = filePath.replace(/^\.agents\//, '.claude/');
      if (!existsSync(adapter)) missingAdapters.push(`${filePath} -> missing ${adapter}`);
    }
  }

  for (const pattern of SCOPED_RULE_GLOBS) {
    for await (const filePath of glob(pattern)) {
      const lines = countLines(filePath);
      if (lines > MAX_LINES) oversized.push(`${filePath}: ${lines} lines`);
      const problem = ruleScopeProblem(filePath);
      if (problem !== null) unscopedRules.push(`${filePath}: ${problem}`);
    }
  }

  const failures = [
    { label: `adapters exceed ${MAX_LINES}-line limit:`, items: oversized },
    { label: 'adapters without a matching .agents/ source:', items: missingSources },
    { label: 'portable sources without a .claude/ adapter:', items: missingAdapters },
    { label: 'path-scoped rules with invalid frontmatter or `paths`:', items: unscopedRules },
    { label: 'subagents Claude Code would skip at load time:', items: undiscoverable },
  ].filter(({ items }) => items.length > 0);

  if (failures.length === 0) {
    console.log(
      `${ui.prefix('[check:adapters]')} ${ui.ok(
        `all adapters are within ${MAX_LINES} lines, map 1:1 to .agents/ sources, every .claude/rules/ file is path-scoped, and every subagent is discoverable`,
      )}`,
    );
    return 0;
  }

  for (const { label, items } of failures) {
    console.error(`${ui.prefix('[check:adapters]')} ${ui.fail(label)}`);
    for (const item of items) console.error(`  ${ui.muted(item)}`);
  }
  console.error(
    ui.muted(
      `\nAdapters must be thin pointers into .agents/ — move workflow content to the matching skill and keep .claude/ and .agents/ in 1:1 sync.`,
    ),
  );
  return 1;
};

process.exit(await main());
