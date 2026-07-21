import { z } from 'zod';

export const PRODUCT_TITLE_MAX_LENGTH = 100;

/**
 * Request-boundary schema for product creation. It is the single source for
 * runtime validation in the controller and for the generated OpenAPI contract,
 * so it lives outside the controller to keep the view layer out of the
 * document build.
 */
export const createProductSchema = z
  .object({
    title: z
      .string()
      .min(1, 'Title is required')
      .max(PRODUCT_TITLE_MAX_LENGTH, 'Title is too long')
      .trim()
      .meta({
        description: 'Product title shown in the shop catalog.',
        example: 'Espresso Machine',
      }),
  })
  .meta({
    description: 'Fields accepted when creating a product.',
  });

export type CreateProductInput = z.infer<typeof createProductSchema>;
