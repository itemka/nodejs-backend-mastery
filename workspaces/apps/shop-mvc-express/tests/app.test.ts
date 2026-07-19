import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface BootedApp {
  baseUrl: string;
  close: () => Promise<void>;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function bootApp(): Promise<BootedApp> {
  // Reset the module graph so each test starts from the in-memory product
  // store's initial empty state instead of leaking state between tests.
  vi.resetModules();
  const { createApp } = await import('../src/app');
  const app = createApp();

  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1');

    server.once('listening', () => {
      const address = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => closeServer(server),
      });
    });

    server.once('error', reject);
  });
}

function encodeForm(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

describe('shop-mvc-express app', () => {
  let booted: BootedApp | undefined;

  afterEach(async () => {
    if (booted) {
      await booted.close();
      booted = undefined;
    }
  });

  it('rejects an empty product title with a 400 validation error page', async () => {
    booted = await bootApp();

    const response = await fetch(`${booted.baseUrl}/products`, {
      body: encodeForm({ title: '' }),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      method: 'POST',
    });

    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html).toContain('Title is required');
  });

  it('escapes an HTML-unsafe product title instead of rendering it raw', async () => {
    booted = await bootApp();
    const maliciousTitle = '<script>alert(1)</script>';

    const createResponse = await fetch(`${booted.baseUrl}/products`, {
      body: encodeForm({ title: maliciousTitle }),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      method: 'POST',
      redirect: 'manual',
    });

    expect(createResponse.status).toBe(302);
    expect(createResponse.headers.get('location')).toBe('/products');

    const listResponse = await fetch(`${booted.baseUrl}/products`);
    const html = await listResponse.text();

    expect(html).not.toContain(maliciousTitle);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('creates a product then lists it (create -> redirect -> list)', async () => {
    booted = await bootApp();

    const createResponse = await fetch(`${booted.baseUrl}/products`, {
      body: encodeForm({ title: 'Espresso Machine' }),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      method: 'POST',
      redirect: 'manual',
    });
    expect(createResponse.status).toBe(302);
    expect(createResponse.headers.get('location')).toBe('/products');

    const listResponse = await fetch(`${booted.baseUrl}/products`);
    expect(listResponse.status).toBe(200);
    const html = await listResponse.text();
    expect(html).toContain('Espresso Machine');
  });

  it('returns an escaped HTML 404 page for unknown routes', async () => {
    booted = await bootApp();

    const response = await fetch(`${booted.baseUrl}/does-not-exist`, {
      headers: { accept: 'text/html' },
    });

    expect(response.status).toBe(404);
    const html = await response.text();
    expect(html).toContain('Page not found');
    expect(html).toContain('/does-not-exist');
  });

  it('returns a JSON 404 error for API-style clients', async () => {
    booted = await bootApp();

    const response = await fetch(`${booted.baseUrl}/does-not-exist`, {
      headers: { accept: 'application/json' },
    });

    expect(response.status).toBe(404);
    const json = (await response.json()) as { error: { code: string } };
    expect(json.error.code).toBe('NOT_FOUND');
  });

  it('sets baseline Helmet security headers', async () => {
    booted = await bootApp();

    const response = await fetch(`${booted.baseUrl}/products`);

    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-powered-by')).toBeNull();
  });
});
