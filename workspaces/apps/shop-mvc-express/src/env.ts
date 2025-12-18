import { baseSchema, defineEnv } from '@workspaces/packages/config';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const schema = baseSchema.extend({
  BODY_PARSER_LIMIT: z
    .string()
    .trim()
    .default('1mb')
    .describe('Maximum size of incoming JSON/urlencoded bodies (supports byte notation)'),
});

export const env = defineEnv(schema);
