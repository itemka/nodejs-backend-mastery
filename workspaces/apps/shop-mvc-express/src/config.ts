import type { AppEnv } from '@workspaces/packages/config';

import { env } from './env';

// TODO: Replace with actual URL
const serviceUrlsByEnv: Record<AppEnv, { userService: string }> = {
  dev: {
    userService: 'https://user-service-dev.internal',
  },
  local: {
    userService: `http://localhost:${env.PORT}`,
  },
  prod: {
    userService: 'https://user-service.internal',
  },
  qa: {
    userService: 'https://user-service-qa.internal',
  },
};

export const config = {
  env: env.APP_ENV,
  nodeEnv: env.NODE_ENV,
  port: env.PORT,
  services: serviceUrlsByEnv[env.APP_ENV],
} as const;
