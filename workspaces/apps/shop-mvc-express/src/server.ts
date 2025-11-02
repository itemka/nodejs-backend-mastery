import { createApp } from './app';
import { env } from './env';
import { registerGracefulShutdown } from './infra/shutdown';

const { NODE_ENV, PORT } = env;

const app = createApp();

const server = app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT} in ${NODE_ENV} mode`);
});

registerGracefulShutdown(server, {
  // add later: closeAll: async () => { await db.end(); await redis.quit(); ... }
});
