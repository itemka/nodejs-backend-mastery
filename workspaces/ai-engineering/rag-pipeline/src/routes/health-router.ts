import { Router } from 'express';

import type { AppContext } from '../app-context.js';
import type { HealthResponse } from '../shared/api.js';

export function createHealthRouter(context: AppContext): Router {
  const router = Router();

  router.get('/', (_request, response) => {
    const sizes = context.retriever.sizes();
    const payload: HealthResponse = {
      embeddingModel: context.env.VOYAGE_EMBEDDING_MODEL,
      indexed: { chunks: sizes.vector, documents: sizes.vector === 0 ? 0 : 1 },
      status: 'ok',
    };

    response.status(200).json(payload);
  });

  return router;
}
