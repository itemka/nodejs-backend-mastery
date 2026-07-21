import { beforeEach, describe, expect, it, vi } from 'vitest';

import { openApiDocument } from '../../src/openapi/document';
import { PRODUCT_TITLE_MAX_LENGTH } from '../../src/schemas/product.schema';
import { productFixtures } from '../fixtures/products.fixture';
import { createApiClient, productPaths } from '../utils/apiClient';

describe('product endpoint contract', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('serves the product list as the documented HTML response', async () => {
    const client = await createApiClient();
    const response = await client.get(productPaths.collection);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/html/);
    expect(openApiDocument.paths?.['/products']?.get?.responses?.['200']).toMatchObject({
      content: { 'text/html': {} },
    });
  });

  it('serves the create form as the documented HTML response', async () => {
    const client = await createApiClient();
    const response = await client.get(productPaths.createForm);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/html/);
    expect(openApiDocument.paths?.['/products/new']?.get?.responses?.['200']).toMatchObject({
      content: { 'text/html': {} },
    });
  });

  it('creates a valid JSON product with the documented redirect', async () => {
    const client = await createApiClient();
    const response = await client.post(productPaths.collection).send(productFixtures.valid);

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(productPaths.collection);
    expect(response.headers['content-type']).toMatch(/^text\/plain/);
    expect(openApiDocument.paths?.['/products']?.post?.responses?.['302']).toMatchObject({
      content: { 'text/html': {}, 'text/plain': {} },
    });

    // The redirect alone does not prove the product was stored; follow it.
    const listResponse = await client.get(productPaths.collection);
    expect(listResponse.text).toContain(productFixtures.valid.title);
  });

  it('returns the documented validation page for an empty JSON title', async () => {
    const client = await createApiClient();
    const response = await client.post(productPaths.collection).send(productFixtures.emptyTitle);

    expect(response.status).toBe(400);
    expect(response.headers['content-type']).toMatch(/^text\/html/);
    expect(openApiDocument.paths?.['/products']?.post?.responses?.['400']).toMatchObject({
      content: { 'text/html': {} },
    });
  });

  it(`returns the documented validation page for a title over ${PRODUCT_TITLE_MAX_LENGTH} characters`, async () => {
    const client = await createApiClient();
    const response = await client
      .post(productPaths.collection)
      .type('form')
      .send(productFixtures.tooLongTitle);

    expect(response.status).toBe(400);
    expect(response.headers['content-type']).toMatch(/^text\/html/);
  });

  it(`accepts the documented ${PRODUCT_TITLE_MAX_LENGTH}-character title boundary`, async () => {
    const client = await createApiClient();
    const response = await client
      .post(productPaths.collection)
      .set('accept', 'text/html')
      .type('form')
      .send(productFixtures.maxLength);

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(productPaths.collection);
    expect(response.headers['content-type']).toMatch(/^text\/html/);
  });
});
