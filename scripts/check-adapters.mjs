// Enforce thin-adapter discipline: fail if any tool-specific adapter file exceeds
// MAX_LINES. Adapters must stay thin pointers into .agents/ — see .agents/README.md.

import { readFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';

import * as ui from '@workspaces/cli-output';

const MAX_LINES = 30;

const ADAPTER_GLOBS = ['.claude/skills/**/*.md', '.claude/agents/*.md', '.claude/commands/*.md'];

const countLines = (filePath) => {
  const text = readFileSync(filePath, 'utf8').replace(/\r?\n$/, '');
  return text === '' ? 0 : text.split(/\r?\n/).length;
};

const main = async () => {
  const violations = [];

  for (const pattern of ADAPTER_GLOBS) {
    for await (const filePath of glob(pattern)) {
      const lines = countLines(filePath);
      if (lines > MAX_LINES) violations.push({ filePath, lines });
    }
  }

  if (violations.length === 0) {
    console.log(
      `${ui.prefix('[check:adapters]')} ${ui.ok(`all adapters are within ${MAX_LINES} lines`)}`,
    );
    return 0;
  }

  console.error(
    `${ui.prefix('[check:adapters]')} ${ui.fail(`adapters exceed ${MAX_LINES}-line limit:`)}`,
  );
  for (const { filePath, lines } of violations) {
    console.error(`  ${ui.muted(filePath)}: ${lines} lines`);
  }
  console.error(
    ui.muted(
      `\nAdapters must be thin pointers into .agents/ — move workflow content to the matching skill.`,
    ),
  );
  return 1;
};

process.exit(await main());
