import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { loadHttpsServerOptions, resolveHttpsCredentialPaths } from './https-server.js';

describe('backend/lib/https-server', () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (!tempDir) {
      return;
    }

    await rm(tempDir, { force: true, recursive: true });
    tempDir = undefined;
  });

  it('loads https credentials from resolved local paths', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'local-llm-playground-https-'));

    await writeFile(path.join(tempDir, 'localhost.pem'), 'cert-data');
    await writeFile(path.join(tempDir, 'localhost-key.pem'), 'key-data');

    const paths = resolveHttpsCredentialPaths(
      {
        HTTPS_CERT_PATH: './localhost.pem',
        HTTPS_KEY_PATH: './localhost-key.pem',
      },
      tempDir,
    );

    expect(paths.certPath).toBe(path.join(tempDir, 'localhost.pem'));
    expect(paths.keyPath).toBe(path.join(tempDir, 'localhost-key.pem'));

    const options = loadHttpsServerOptions(
      {
        HTTPS_CERT_PATH: './localhost.pem',
        HTTPS_KEY_PATH: './localhost-key.pem',
      },
      tempDir,
    );

    expect(options.cert).toEqual(Buffer.from('cert-data'));
    expect(options.key).toEqual(Buffer.from('key-data'));
  });

  it('throws an actionable error when credentials are missing', () => {
    expect(() =>
      loadHttpsServerOptions({
        HTTPS_CERT_PATH: './missing-cert.pem',
        HTTPS_KEY_PATH: './missing-key.pem',
      }),
    ).toThrowError(/Unable to load HTTPS credentials/);
  });
});
