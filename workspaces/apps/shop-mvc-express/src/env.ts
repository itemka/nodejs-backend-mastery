import { baseSchema, defineEnv } from '@workspaces/packages/config';
import dotenv from 'dotenv';

dotenv.config();

export const env = defineEnv(baseSchema);
