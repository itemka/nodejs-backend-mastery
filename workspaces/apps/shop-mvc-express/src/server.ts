import { createApp } from './app';
import { config } from './config';
import { registerGracefulShutdown } from './infra/shutdown';

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(
    `Server listening on http://localhost:${config.port} in ${config.nodeEnv} mode (APP_ENV=${config.env})`,
  );
});

registerGracefulShutdown(server, {
  // add later: closeAll: async () => { await db.end(); await redis.quit(); ... }
});
