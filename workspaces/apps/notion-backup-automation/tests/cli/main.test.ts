import { describe, expect, it } from 'vitest';

import { parseCommand, UsageError } from '../../src/cli/args.js';
import { main } from '../../src/cli/main.js';
import { testCli } from '../support/cli-context.js';
import { fakeCredentials } from '../support/fake-google.js';

describe('parseCommand', () => {
  it.each([
    [[], { command: 'help' }],
    [['--help'], { command: 'help' }],
    [['auth:google'], { command: 'auth:google', pickFolders: false, print: false }],
    [['auth:google', '--print'], { command: 'auth:google', pickFolders: false, print: true }],
    [
      ['auth:google', '--pick-folders'],
      { command: 'auth:google', pickFolders: true, print: false },
    ],
    [['drive:check'], { command: 'drive:check', year: undefined }],
    [['drive:check', '--year', '2027'], { command: 'drive:check', year: '2027' }],
    [['drive:init'], { command: 'drive:init' }],
    [['doctor'], { command: 'doctor', emailSince: undefined }],
    [['doctor', '--email-since', '2026-10-01'], { command: 'doctor', emailSince: '2026-10-01' }],
    [['dev:upload', 'backup.zip'], { command: 'dev:upload', path: 'backup.zip' }],
    [['auth:notion'], { command: 'auth:notion' }],
    [['dev:trigger'], { command: 'dev:trigger', dryRun: false, headed: false }],
    [
      ['dev:trigger', '--dry-run', '--headed'],
      { command: 'dev:trigger', dryRun: true, headed: true },
    ],
    [['dev:download'], { command: 'dev:download', emailSince: undefined }],
    [
      ['dev:download', '--email-since', '2026-10-18'],
      { command: 'dev:download', emailSince: '2026-10-18' },
    ],
  ])('%j', (argv, expected) => {
    expect(parseCommand(argv)).toEqual(expected);
  });

  it.each([
    [['backup']],
    [['auth:google', '--unknown']],
    [['auth:google', '--print', '--pick-folders']],
    [['auth:google', 'extra']],
    [['drive:check', '--year', '26']],
    [['drive:init', '--force']],
    [['doctor', '--email-since', 'yesterday']],
    [['doctor', '--email-since', '2026-02-30']],
    [['dev:upload']],
    [['dev:upload', 'a.zip', 'b.zip']],
    [['dev:upload', '--force', 'a.zip']],
    [['auth:notion', '--print']],
    [['auth:notion', 'extra']],
    [['dev:trigger', '--force']],
    [['dev:trigger', 'now']],
    [['dev:download', '--email-since', '2026-13-01']],
    [['dev:download', 'latest']],
  ])('rejects %j', (argv) => {
    expect(() => parseCommand(argv)).toThrow(UsageError);
  });
});

describe('main', () => {
  it('prints the usage for help and exits 0', async () => {
    const { context, text } = await testCli();

    await expect(main(['help'], context)).resolves.toBe(0);
    expect(text()).toContain('Usage: pnpm --filter notion-backup-automation cli <command>');
  });

  it('exits 2 with the usage for a wrong command line', async () => {
    const { context, output } = await testCli();

    await expect(main(['drive:check', '--year', 'next'], context)).resolves.toBe(2);
    expect(output[0]).toBe('--year must be four digits, such as 2026');
    expect(output[1]).toContain('Usage:');
  });

  it('reports an unexpected error without its secrets', async () => {
    const { context, text } = await testCli({
      env: {
        GOOGLE_CLIENT_ID: fakeCredentials.clientId,
        GOOGLE_CLIENT_SECRET: fakeCredentials.clientSecret,
      },
      openBrowser: () =>
        Promise.reject(
          new Error(
            `failed at https://example.com/cb?code=abc&token=${fakeCredentials.refreshToken}`,
          ),
        ),
    });

    await expect(main(['auth:google'], context)).resolves.toBe(1);
    expect(text()).toContain(
      '✗ Unexpected error. Error: failed at https://example.com/cb[redacted]',
    );
    expect(text()).not.toContain(fakeCredentials.refreshToken);
  });
});
