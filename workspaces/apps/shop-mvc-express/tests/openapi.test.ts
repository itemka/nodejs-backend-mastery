import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { httpErrorResponseSchema, openApiDocument } from '../src/openapi/document';
import { createApiClient, docsPaths } from './utils/apiClient';

// Directives helmet applies app-wide. The docs routes must not trade any of
// them away for a hand-rolled, shorter policy.
const REQUIRED_CSP_DIRECTIVES = [
  "script-src 'self'",
  "script-src-attr 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
];

describe('OpenAPI document', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('builds an OpenAPI 3.1 document for every served path', () => {
    expect(openApiDocument.openapi).toBe('3.1.0');
    expect(Object.keys(openApiDocument.paths ?? {}).toSorted()).toEqual([
      '/docs',
      '/openapi.json',
      '/products',
      '/products/new',
    ]);
    expect(openApiDocument.components?.schemas?.HttpErrorResponse).toBeDefined();
  });

  it('serves the same contract that CI drift-checks', async () => {
    const client = await createApiClient();
    const response = await client.get(docsPaths.contract);
    const committed = await readFile(
      path.resolve(import.meta.dirname, '../docs/openapi.json'),
      'utf8',
    );

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(response.body).toEqual(JSON.parse(committed));
  });

  it('redirects /docs to the trailing-slash form so relative assets resolve', async () => {
    const client = await createApiClient();
    const response = await client.get(docsPaths.uiWithoutSlash);

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(docsPaths.ui);
  });

  it('serves Swagger UI and its assets at /docs/', async () => {
    const client = await createApiClient();
    const response = await client.get(docsPaths.ui);
    const cssResponse = await client.get('/docs/swagger-ui.css');
    const initResponse = await client.get('/docs/swagger-ui-init.js');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/html/);
    expect(response.text).toContain('Swagger UI');
    expect(cssResponse.status).toBe(200);
    expect(cssResponse.headers['content-type']).toMatch(/^text\/css/);
    expect(initResponse.status).toBe(200);
    expect(initResponse.headers['content-type']).toMatch(/^application\/javascript/);
  });

  it('keeps the app-wide Helmet CSP on the docs routes', async () => {
    const client = await createApiClient();
    const productsResponse = await client.get('/products');
    const docsResponse = await client.get(docsPaths.ui);
    const productsPolicy = productsResponse.headers['content-security-policy'];
    const docsPolicy = docsResponse.headers['content-security-policy'];

    expect(docsPolicy).toBe(productsPolicy);

    for (const directive of REQUIRED_CSP_DIRECTIVES) {
      expect(docsPolicy).toContain(directive);
    }

    expect(docsPolicy).not.toContain("script-src 'self' 'unsafe-inline'");
  });

  it('returns errors in the documented HttpErrorResponse envelope', async () => {
    const client = await createApiClient();
    const response = await client.get('/does-not-exist').set('accept', 'application/json');

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(() => httpErrorResponseSchema.parse(response.body)).not.toThrow();
  });

  describe('in production', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('does not expose the contract or Swagger UI', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.resetModules();

      const client = await createApiClient();
      const contractResponse = await client.get(docsPaths.contract);
      const uiResponse = await client.get(docsPaths.ui);
      const uiWithoutSlashResponse = await client.get(docsPaths.uiWithoutSlash);

      expect(contractResponse.status).toBe(404);
      expect(uiResponse.status).toBe(404);
      expect(uiWithoutSlashResponse.status).toBe(404);
    });
  });
});
