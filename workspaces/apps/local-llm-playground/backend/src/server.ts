import 'dotenv/config';
import { createServer } from 'node:http';

import { createApp } from './app.js';

const { app, context } = createApp();
const server = createServer(app);

server.on('error', (error) => {
  context.logger.error('server.listen_failed', {
    error: error.message,
  });
  process.exitCode = 1;
  server.close();
});

server.listen(context.env.PORT, () => {
  context.logger.info('server.started', {
    mode: context.env.NODE_ENV,
    ollamaBaseUrl: context.env.OLLAMA_BASE_URL,
    port: context.env.PORT,
  });
});

let shuttingDown = false;

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;

    context.logger.info('server.shutdown_requested', {
      signal,
    });

    server.close((error) => {
      if (error) {
        context.logger.error('server.shutdown_failed', {
          error: error.message,
        });
        process.exitCode = 1;

        return;
      }

      context.logger.info('server.shutdown_complete');
      process.exitCode = 0;
    });
  });
}
