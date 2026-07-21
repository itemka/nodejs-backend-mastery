import { createProductSchema, PRODUCT_TITLE_MAX_LENGTH } from '../../src/schemas/product.schema';

export const productFixtures = {
  emptyTitle: { title: '' },
  maxLength: createProductSchema.parse({ title: 'x'.repeat(PRODUCT_TITLE_MAX_LENGTH) }),
  tooLongTitle: { title: 'x'.repeat(PRODUCT_TITLE_MAX_LENGTH + 1) },
  valid: createProductSchema.parse({ title: 'Espresso Machine' }),
} as const;
