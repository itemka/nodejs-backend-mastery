import 'dotenv/config';

import { createApp } from './app.js';
import { createHttpsAppServer } from './lib/https-server.js';

const { app, context } = createApp();
const server = createHttpsAppServer(app, context.env);

server.on('error', (error) => {
  context.logger.error('server.listen_failed', {
    error: error.message,
  });
  process.exitCode = 1;
  server.close();
});

server.listen(context.env.PORT, context.env.HOST, () => {
  context.logger.info('server.started', {
    host: context.env.HOST,
    mode: context.env.NODE_ENV,
    ollamaBaseUrl: context.env.OLLAMA_BASE_URL,
    origin: toHttpsOrigin(context.env.HOST, context.env.PORT),
    port: context.env.PORT,
    protocol: 'https',
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

function toHttpsOrigin(host: string, port: number): string {
  const formattedHost = host.includes(':') ? `[${host}]` : host;

  return `https://${formattedHost}:${port}`;
}
