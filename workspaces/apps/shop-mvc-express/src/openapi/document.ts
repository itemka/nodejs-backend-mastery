import { z } from 'zod';
import { createDocument } from 'zod-openapi';

import { createProductSchema } from '../schemas/product.schema';

const htmlPageSchema = z.string().meta({
  description: 'A server-rendered HTML page.',
});

export const httpErrorResponseSchema = z
  .object({
    error: z.object({
      code: z.string().meta({ example: 'INTERNAL_SERVER_ERROR' }),
      details: z.unknown().optional(),
      message: z.string().meta({ example: 'An unexpected error occurred.' }),
    }),
  })
  .meta({
    description: 'Shared JSON envelope returned for negotiated HTTP errors.',
  });

const negotiatedErrorResponse = {
  content: {
    'application/json': { schema: httpErrorResponseSchema },
    'text/html': { schema: htmlPageSchema },
  },
  description: 'An error rendered as HTML or as the shared JSON error envelope.',
} as const;

export const openApiDocument = createDocument({
  components: {
    schemas: {
      CreateProductInput: createProductSchema,
      HttpErrorResponse: httpErrorResponseSchema,
    },
  },
  info: {
    description: 'Contract for the product routes implemented by shop-mvc-express.',
    title: 'Shop MVC Express API',
    version: '1.0.0',
  },
  openapi: '3.1.0',
  paths: {
    '/docs': {
      get: {
        description:
          'Available outside production only. Redirects to the trailing-slash form, which serves the Swagger UI page and its assets.',
        operationId: 'getDocsUi',
        responses: {
          '302': {
            description: 'Redirect to the Swagger UI entry point.',
            headers: z.object({
              Location: z.literal('/docs/').meta({
                description: 'Swagger UI entry point, where relative asset URLs resolve.',
              }),
            }),
          },
          default: negotiatedErrorResponse,
        },
        summary: 'Browse the API contract in Swagger UI',
        tags: ['Documentation'],
      },
    },
    '/openapi.json': {
      get: {
        description: 'Available outside production only.',
        operationId: 'getOpenApiDocument',
        responses: {
          '200': {
            content: { 'application/json': { schema: z.record(z.string(), z.unknown()) } },
            description: 'This OpenAPI document.',
          },
          default: negotiatedErrorResponse,
        },
        summary: 'Fetch this OpenAPI document',
        tags: ['Documentation'],
      },
    },
    '/products': {
      get: {
        operationId: 'listProducts',
        responses: {
          '200': {
            content: { 'text/html': { schema: htmlPageSchema } },
            description: 'Product listing page.',
          },
          default: negotiatedErrorResponse,
        },
        summary: 'List products',
        tags: ['Products'],
      },
      post: {
        operationId: 'createProduct',
        requestBody: {
          content: {
            'application/json': { schema: createProductSchema },
            'application/x-www-form-urlencoded': { schema: createProductSchema },
          },
          required: true,
        },
        responses: {
          '302': {
            content: {
              'text/html': { schema: htmlPageSchema },
              'text/plain': { schema: z.string() },
            },
            description:
              'Product created; redirect to the product listing. The body is empty when the client accepts neither text format.',
            headers: z.object({
              Location: z.literal('/products').meta({
                description: 'Location of the product listing.',
              }),
            }),
          },
          '400': {
            content: { 'text/html': { schema: htmlPageSchema } },
            description: 'Product validation failed.',
          },
          default: negotiatedErrorResponse,
        },
        summary: 'Create a product',
        tags: ['Products'],
      },
    },
    '/products/new': {
      get: {
        operationId: 'renderCreateProductForm',
        responses: {
          '200': {
            content: { 'text/html': { schema: htmlPageSchema } },
            description: 'Create-product HTML form.',
          },
          default: negotiatedErrorResponse,
        },
        summary: 'Show the create-product form',
        tags: ['Products'],
      },
    },
  },
  security: [],
  servers: [{ description: 'Current server', url: '/' }],
  tags: [
    { description: 'Server-rendered product catalog routes.', name: 'Products' },
    { description: 'Contract and Swagger UI routes (non-production).', name: 'Documentation' },
  ],
});
