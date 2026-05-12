import 'dotenv/config';

import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { VoyageEmbeddingProvider } from './embeddings/voyage-embedding-provider.js';

const env = loadEnv();
const embeddingProvider = new VoyageEmbeddingProvider({
  apiKey: env.VOYAGE_API_KEY,
  model: env.VOYAGE_EMBEDDING_MODEL,
  timeoutMs: env.REQUEST_TIMEOUT_MS,
});
const { app, context } = createApp({ embeddingProvider, env });
const server = app.listen(context.env.PORT, context.env.HOST, () => {
  context.logger.info('rag.server_started', {
    embeddingModel: context.env.VOYAGE_EMBEDDING_MODEL,
    host: context.env.HOST,
    port: context.env.PORT,
  });
});

server.on('error', (error) => {
  context.logger.error('rag.server_listen_failed', {
    error: error.message,
  });
  process.exitCode = 1;
});

let shuttingDown = false;

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    context.logger.info('rag.server_shutdown_requested', { signal });
    server.close((error) => {
      if (error) {
        context.logger.error('rag.server_shutdown_failed', { error: error.message });
        process.exitCode = 1;

        return;
      }

      context.logger.info('rag.server_shutdown_complete');
    });
  });
}
