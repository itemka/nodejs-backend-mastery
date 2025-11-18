import { createApp } from './app';
import { config } from './config';
import { registerGracefulShutdown } from './infra/shutdown';

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(
    `Server listening on http://localhost:${config.port} in ${config.nodeEnv} mode (DEPLOYMENT_ENV=${config.deploymentEnv})`,
  );
});

registerGracefulShutdown(server, {
  // add later: closeAll: async () => { await db.end(); await redis.quit(); ... }
});
