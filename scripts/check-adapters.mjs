// Enforce thin-adapter discipline — see .agents/README.md:
// 1. Tool-specific adapter files must stay within MAX_LINES.
// 2. Every .claude/ adapter must have a matching .agents/ source, and every
//    portable skill, agent, and command must have a .claude/ adapter.

import { existsSync, readFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';

import * as ui from '@workspaces/cli-output';

const MAX_LINES = 30;

const ADAPTER_GLOBS = ['.claude/skills/**/*.md', '.claude/agents/*.md', '.claude/commands/*.md'];
const SOURCE_GLOBS = ['.agents/skills/*/SKILL.md', '.agents/agents/*.md', '.agents/commands/*.md'];

const countLines = (filePath) => {
  const text = readFileSync(filePath, 'utf8').replace(/\r?\n$/, '');
  return text === '' ? 0 : text.split(/\r?\n/).length;
};

const main = async () => {
  const oversized = [];
  const missingSources = [];
  const missingAdapters = [];

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

  const failures = [
    { label: `adapters exceed ${MAX_LINES}-line limit:`, items: oversized },
    { label: 'adapters without a matching .agents/ source:', items: missingSources },
    { label: 'portable sources without a .claude/ adapter:', items: missingAdapters },
  ].filter(({ items }) => items.length > 0);

  if (failures.length === 0) {
    console.log(
      `${ui.prefix('[check:adapters]')} ${ui.ok(
        `all adapters are within ${MAX_LINES} lines and map 1:1 to .agents/ sources`,
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
