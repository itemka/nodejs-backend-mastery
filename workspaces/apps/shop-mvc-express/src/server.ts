import * as ui from '@workspaces/cli-output';

import { createApp } from './app';
import { config } from './config';
import { registerGracefulShutdown } from './infra/shutdown';

const app = createApp();

const server = app.listen(config.port, () => {
  const listenMessage = `Server listening on http://localhost:${config.port} in ${config.nodeEnv} mode`;
  const deploymentMessage = `(DEPLOYMENT_ENV=${config.deploymentEnv})`;

  console.log([ui.success(listenMessage), ui.muted(deploymentMessage)].join(' '));
});

registerGracefulShutdown(server, {
  // add later: closeAll: async () => { await db.end(); await redis.quit(); ... }
});
