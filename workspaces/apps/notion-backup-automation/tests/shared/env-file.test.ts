import { chmod, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { upsertEnvFile } from '../../src/shared/env-file.js';

let directory: string;
let envFile: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'nba-env-file-'));
  envFile = path.join(directory, '.env.local');
});

afterEach(async () => {
  await rm(directory, { force: true, recursive: true });
});

async function mode(filePath: string): Promise<number> {
  const stats = await stat(filePath);

  return stats.mode & 0o777;
}

describe('upsertEnvFile', () => {
  it('creates the file with mode 0600', async () => {
    await upsertEnvFile(envFile, { GOOGLE_REFRESH_TOKEN: '1//0gAbC-dEf_123' });

    expect(await readFile(envFile, 'utf8')).toBe('GOOGLE_REFRESH_TOKEN=1//0gAbC-dEf_123\n');
    expect(await mode(envFile)).toBe(0o600);
  });

  it('replaces a value in place and keeps comments, order and other lines', async () => {
    await writeFile(
      envFile,
      [
        '# Google',
        'GOOGLE_CLIENT_ID=client',
        'GOOGLE_REFRESH_TOKEN=old',
        '',
        'APP_ENV=dev',
        'GOOGLE_REFRESH_TOKEN=duplicate',
        '',
      ].join('\n'),
    );

    await upsertEnvFile(envFile, { GOOGLE_REFRESH_TOKEN: 'new', NEW_VALUE: 'a+b/c=' });

    expect(await readFile(envFile, 'utf8')).toBe(
      [
        '# Google',
        'GOOGLE_CLIENT_ID=client',
        'GOOGLE_REFRESH_TOKEN=new',
        '',
        'APP_ENV=dev',
        'NEW_VALUE=a+b/c=',
        '',
      ].join('\n'),
    );
  });

  it('tightens the mode of an existing file to 0600', async () => {
    await writeFile(envFile, 'APP_ENV=dev\n');
    await chmod(envFile, 0o644);

    await upsertEnvFile(envFile, { APP_ENV: 'prod' });

    expect(await mode(envFile)).toBe(0o600);
  });

  it('writes values that Node’s env-file parser reads back unchanged', async () => {
    const value = 'abc+/=._:@~-XYZ';

    await upsertEnvFile(envFile, { NBA_TEST_VALUE: value });

    // The same parser as process.loadEnvFile, without touching process.env.
    expect(parseEnv(await readFile(envFile, 'utf8'))).toEqual({ NBA_TEST_VALUE: value });
  });

  it.each([
    [{ 'bad-name': 'x' }, 'Invalid env variable name: bad-name'],
    [{ GOOD: 'has space' }, 'The value for GOOD contains characters that need quoting'],
    [{ GOOD: 'a#comment' }, 'The value for GOOD contains characters that need quoting'],
    [{ GOOD: 'line\nbreak' }, 'The value for GOOD contains characters that need quoting'],
  ])('rejects %j without touching the file', async (values, message) => {
    await writeFile(envFile, 'APP_ENV=dev\n');

    await expect(upsertEnvFile(envFile, values)).rejects.toThrow(message);
    expect(await readFile(envFile, 'utf8')).toBe('APP_ENV=dev\n');
  });

  it('leaves no temporary file behind', async () => {
    await upsertEnvFile(envFile, { APP_ENV: 'dev' });

    expect(await readdir(directory)).toEqual(['.env.local']);
  });
});
