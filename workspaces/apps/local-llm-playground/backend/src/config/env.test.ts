import { describe, expect, it } from 'vitest';

import { loadEnv } from './env.js';

describe('backend/config/env', () => {
  it('uses secure local server defaults', () => {
    const env = loadEnv({});

    expect(env.HOST).toBe('127.0.0.1');
    expect(env.HTTPS_CERT_PATH).toBe('.certs/localhost.pem');
    expect(env.HTTPS_KEY_PATH).toBe('.certs/localhost-key.pem');
    expect(env.PORT).toBe(4000);
  });

  it('accepts custom host and https credential paths', () => {
    const env = loadEnv({
      HOST: 'localhost',
      HTTPS_CERT_PATH: './tls/dev-cert.pem',
      HTTPS_KEY_PATH: './tls/dev-key.pem',
    });

    expect(env.HOST).toBe('localhost');
    expect(env.HTTPS_CERT_PATH).toBe('./tls/dev-cert.pem');
    expect(env.HTTPS_KEY_PATH).toBe('./tls/dev-key.pem');
  });
});
