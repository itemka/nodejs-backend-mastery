import { NotFoundError } from '@workspaces/packages/errors';
import express from 'express';
import path from 'node:path';

import type { AppContext } from './app-context.js';
import { loadEnv } from './config/env.js';
import type { AppEnv } from './config/env.js';
import type { EmbeddingProvider } from './embeddings/embedding-provider.js';
import { Bm25Index } from './indexes/bm25-index.js';
import { InMemoryVectorIndex } from './indexes/in-memory-vector-index.js';
import { Retriever } from './retrieval/retriever.js';
import { createHealthRouter } from './routes/health-router.js';
import { createIngestRouter } from './routes/ingest-router.js';
import { createSearchRouter } from './routes/search-router.js';
import { toApiErrorPayload } from './shared/app-error.js';
import { logger as defaultLogger } from './shared/logger.js';
import type { Logger } from './shared/logger.js';

export interface CreateAppOptions {
  readonly allowedDocumentRoot?: string;
  readonly embeddingProvider: EmbeddingProvider;
  readonly env?: AppEnv;
  readonly logger?: Logger;
}

export function createApp(options: CreateAppOptions): {
  app: express.Express;
  context: AppContext;
} {
  const env = options.env ?? loadEnv();
  const logger = options.logger ?? defaultLogger;
  const allowedDocumentRoot = path.resolve(
    options.allowedDocumentRoot ?? path.resolve(process.cwd(), 'sample-documents'),
  );
  const vectorIndex = new InMemoryVectorIndex();
  const bm25Index = new Bm25Index();
  const retriever = new Retriever({
    bm25Index,
    embeddingProvider: options.embeddingProvider,
    vectorIndex,
  });
  const context: AppContext = {
    allowedDocumentRoot,
    env,
    logger,
    retriever,
  };

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use('/health', createHealthRouter(context));
  app.use('/ingest', createIngestRouter(context));
  app.use('/search', createSearchRouter(context));

  app.use((request, _response, next) => {
    next(
      new NotFoundError({
        details: { path: request.originalUrl },
        message: `No route matches ${request.method} ${request.originalUrl}.`,
      }),
    );
  });

  app.use(
    (
      error: unknown,
      request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      const payload = toApiErrorPayload(error);

      logger.error('rag.request_failed', {
        code: payload.code,
        message: error instanceof Error ? error.message : String(error),
        method: request.method,
        path: request.originalUrl,
        statusCode: payload.statusCode,
      });

      if (response.headersSent) {
        return;
      }

      response.status(payload.statusCode).json({ error: payload });
    },
  );

  return { app, context };
}
