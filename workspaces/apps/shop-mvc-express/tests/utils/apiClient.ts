import request from 'supertest';

export const productPaths = {
  collection: '/products',
  createForm: '/products/new',
} as const;

export const docsPaths = {
  contract: '/openapi.json',
  ui: '/docs/',
  uiWithoutSlash: '/docs',
} as const;

export async function createApiClient() {
  const { createApp } = await import('../../src/app');

  return request(createApp());
}
