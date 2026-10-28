import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

const execute = promisify(execFile);

it('loads the built package in plain Node without a TypeScript loader', async () => {
  const { stdout } = await execute(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
        import { integrationUpdateSchema } from '@workspaces/telegram-contracts';
        const update = integrationUpdateSchema.parse({
          input: { kind: 'message', text: '/status' }, updateId: 1,
        });
        console.log(JSON.stringify({
          javascript: import.meta.resolve('@workspaces/telegram-contracts').endsWith('.js'),
          update,
        }));
      `,
    ],
    { cwd: fileURLToPath(new URL('..', import.meta.url)) },
  );

  expect(JSON.parse(stdout)).toEqual({
    javascript: true,
    update: { input: { kind: 'message', text: '/status' }, updateId: 1 },
  });
});
