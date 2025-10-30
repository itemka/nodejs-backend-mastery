import dotenv from 'dotenv';

// TODO: Fix this import.
import { baseSchema, defineEnv } from '../../../packages/config/dist/index.js';

dotenv.config();

export const env = defineEnv(baseSchema);
