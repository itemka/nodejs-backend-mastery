import type express from 'express';
import { readFileSync } from 'node:fs';
import { createServer, type ServerOptions } from 'node:https';
import path from 'node:path';

import type { AppEnv } from '../config/env.js';

export function createHttpsAppServer(
  app: express.Express,
  env: Pick<AppEnv, 'HTTPS_CERT_PATH' | 'HTTPS_KEY_PATH'>,
) {
  return createServer(loadHttpsServerOptions(env), app);
}

export function loadHttpsServerOptions(
  env: Pick<AppEnv, 'HTTPS_CERT_PATH' | 'HTTPS_KEY_PATH'>,
  cwd = process.cwd(),
): ServerOptions {
  const { certPath, keyPath } = resolveHttpsCredentialPaths(env, cwd);

  try {
    return {
      cert: readFileSync(certPath),
      key: readFileSync(keyPath),
    };
  } catch (error) {
    throw new Error(
      `Unable to load HTTPS credentials from "${keyPath}" and "${certPath}". Generate local certificates or set HTTPS_KEY_PATH/HTTPS_CERT_PATH.`,
      {
        cause: error,
      },
    );
  }
}

export function resolveHttpsCredentialPaths(
  env: Pick<AppEnv, 'HTTPS_CERT_PATH' | 'HTTPS_KEY_PATH'>,
  cwd = process.cwd(),
) {
  return {
    certPath: path.resolve(cwd, env.HTTPS_CERT_PATH),
    keyPath: path.resolve(cwd, env.HTTPS_KEY_PATH),
  };
}
