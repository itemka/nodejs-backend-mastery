import type { DeploymentEnv } from '@workspaces/packages/config';

import { env } from './env';

type ShopMvcExpressDeploymentEnv = Exclude<DeploymentEnv, 'staging'>;

// TODO: Replace with actual URLs for real services
const serviceUrlsByEnv: Record<ShopMvcExpressDeploymentEnv, { userService: string }> = {
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

function toShopMvcExpressDeploymentEnv(envValue: DeploymentEnv): ShopMvcExpressDeploymentEnv {
  if (envValue === 'staging') {
    throw new Error('DEPLOYMENT_ENV="staging" is not supported for shop-mvc-express');
  }

  return envValue;
}

const deploymentEnv = toShopMvcExpressDeploymentEnv(env.DEPLOYMENT_ENV);

export const config = {
  deploymentEnv,
  nodeEnv: env.NODE_ENV,
  port: env.PORT,
  services: serviceUrlsByEnv[deploymentEnv],
} as const;
