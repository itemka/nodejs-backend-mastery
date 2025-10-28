// import { z } from 'zod';
import { baseSchema, defineEnv } from '../../../packages/config/src/index.js';

const schema = baseSchema.extend({
  // Example: DATABASE_URL: z.string().optional(),
});

export const env = defineEnv(schema);
