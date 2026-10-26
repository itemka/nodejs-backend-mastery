import { describe, expect, it } from 'vitest';

import { HttpHeartbeat, NoopHeartbeat } from '../../../src/adapters/heartbeat/http-heartbeat.js';
import { createLogger } from '../../../src/shared/logger.js';
import { SecretValue } from '../../../src/shared/secret-value.js';

const PING_URL = 'https://hc-ping.example/0b4c9a1e-7f20-4a55-9f3c-secretuuid';

function setup(respond: (url: string) => Promise<Response>) {
  const requests: { method: string | undefined; url: string }[] = [];
  const logs: string[] = [];
  const heartbeat = new HttpHeartbeat({
    fetch: (input, init) => {
      const url = input instanceof Request ? input.url : String(input);

      requests.push({ method: init?.method, url });

      return respond(url);
    },
    logger: createLogger({
      sink: (_level, line) => {
        logs.push(line);
      },
    }),
    url: new SecretValue(`${PING_URL}/`),
  });

  return { heartbeat, logs, requests };
}

describe('HttpHeartbeat', () => {
  it('pings the URL after a clean run and /fail after a failed one', async () => {
    const { heartbeat, logs, requests } = setup(() => Promise.resolve(new Response('OK')));

    await heartbeat.ok();
    await heartbeat.fail();

    expect(requests).toEqual([
      { method: 'GET', url: PING_URL },
      { method: 'GET', url: `${PING_URL}/fail` },
    ]);
    expect(logs.join('\n')).not.toContain('secretuuid');
  });

  it('never throws, and never logs the URL', async () => {
    const refused = setup(() => Promise.resolve(new Response('nope', { status: 404 })));
    const broken = setup((url) => Promise.reject(new TypeError(`fetch failed: ${url}`)));

    await expect(refused.heartbeat.ok()).resolves.toBeUndefined();
    await expect(broken.heartbeat.fail()).resolves.toBeUndefined();

    expect(refused.logs.join('\n')).toContain('"status":404');
    expect(broken.logs.join('\n')).toContain('"reason":"network"');

    for (const { logs } of [refused, broken]) {
      expect(logs.join('\n')).not.toContain('secretuuid');
    }
  });
});

describe('NoopHeartbeat', () => {
  it('does nothing', async () => {
    const heartbeat = new NoopHeartbeat();

    await expect(heartbeat.ok()).resolves.toBeUndefined();
    await expect(heartbeat.fail()).resolves.toBeUndefined();
  });
});
