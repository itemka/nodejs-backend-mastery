import * as ui from '@workspaces/cli-output';

import { createApp } from './app';
import { config } from './config';
import { registerGracefulShutdown } from './infra/shutdown';

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(
    `${ui.success(`Server listening on http://localhost:${config.port} in ${config.nodeEnv} mode`)} ${ui.muted(`(DEPLOYMENT_ENV=${config.deploymentEnv})`)}`,
  );
});

registerGracefulShutdown(server, {
  // add later: closeAll: async () => { await db.end(); await redis.quit(); ... }
});
