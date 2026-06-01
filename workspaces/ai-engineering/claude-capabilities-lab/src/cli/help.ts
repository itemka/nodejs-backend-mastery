import * as ui from '@workspaces/cli-output';

import { SCENARIO_NAMES } from './args.js';

export const HELP_TEXT = [
  ui.heading('Usage: pnpm --filter claude-capabilities-lab dev -- <scenario> [options]'),
  '',
  ui.heading('Scenarios:'),
  ...SCENARIO_NAMES.map((name) => `  ${ui.accent(name)}`),
  '',
  ui.heading('Common options:'),
  '  --prompt=<text>            Override the default prompt for the scenario.',
  '  --max-tokens=<n>           Override the max tokens per request.',
  '  --debug-response           Print the raw Anthropic response object.',
  '  -h, --help                 Show this help message.',
  '',
  'Scenario-specific options are listed in claude-capabilities-lab/README.md.',
].join('\n');

export const SCENARIO_HELP: Record<string, string> = {
  cache: [
    'Usage: ... cache --target=system|tools|document|image|last-message',
    '       [--ttl=5m|1h] [--prompt=<text>] [--document=<path>] [--image=<path>]',
  ].join('\n'),
  citations: [
    'Usage: ... citations [--pdf=<path>] [--text-document=<path>] [--prompt=<text>] [--max-tokens=<n>]',
  ].join('\n'),
  'code-exec': [
    'Usage: ... code-exec --file=<path> [--prompt=<text>] [--download-outputs]',
    '       [--out-dir=outputs] [--max-tokens=<n>]',
  ].join('\n'),
  files: [
    'Usage: ... files <upload|list|metadata|delete|download> [options]',
    '  files upload --file=<path>',
    '  files list',
    '  files metadata --file-id=<id>',
    '  files delete --file-id=<id>',
    '  files download --file-id=<id> --out-dir=outputs',
  ].join('\n'),
  image: [
    'Usage: ... image --image=<path> [--image=<path> ...] [--prompt=<text>] [--max-tokens=<n>]',
  ].join('\n'),
  pdf: [
    'Usage: ... pdf --pdf=<path> [--prompt=<text>] [--citations] [--cache] [--max-tokens=<n>]',
  ].join('\n'),
  thinking: [
    'Usage: ... thinking [--thinking-mode=adaptive|enabled|disabled]',
    '       [--thinking-budget-tokens=<n>] [--thinking-display=summarized|omitted]',
    '       [--show-thinking] [--max-tokens=<n>] [--prompt=<text>]',
  ].join('\n'),
};
