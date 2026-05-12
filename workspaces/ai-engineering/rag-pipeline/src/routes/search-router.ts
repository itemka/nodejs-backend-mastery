import { Router } from 'express';

import type { AppContext } from '../app-context.js';
import type { SearchResponse, SearchResponseChunk } from '../shared/api.js';
import { EMPTY_INDEX_NOTE, searchRequestSchema } from '../shared/api.js';
import { asyncHandler } from '../shared/async-handler.js';
import type { SearchResult } from '../shared/types.js';

function toResponseChunk(result: SearchResult): SearchResponseChunk {
  return {
    chunkId: result.chunk.chunkId,
    chunkIndex: result.chunk.chunkIndex,
    content: result.chunk.content,
    documentId: result.chunk.documentId,
    fusedScore: result.fusedScore,
    ...(result.lexicalRank === undefined ? {} : { lexicalRank: result.lexicalRank }),
    ...(result.lexicalScore === undefined ? {} : { lexicalScore: result.lexicalScore }),
    ...(result.chunk.sectionTitle === undefined ? {} : { sectionTitle: result.chunk.sectionTitle }),
    ...(result.semanticRank === undefined ? {} : { semanticRank: result.semanticRank }),
    ...(result.semanticScore === undefined ? {} : { semanticScore: result.semanticScore }),
    sourceName: result.chunk.sourceName,
    sourcePath: result.chunk.sourcePath,
  };
}

export function createSearchRouter(context: AppContext): Router {
  const router = Router();

  router.post(
    '/',
    asyncHandler(async (request, response) => {
      const body = searchRequestSchema.parse(request.body ?? {});
      const sizesBefore = context.retriever.sizes();
      const indexEmpty = sizesBefore.bm25 === 0 && sizesBefore.vector === 0;
      const results = await context.retriever.search(body.query, body.topK);

      const payload: SearchResponse = {
        query: body.query.trim(),
        results: results.map((result) => toResponseChunk(result)),
        topK: body.topK,
        ...(indexEmpty ? { indexEmpty: true, note: EMPTY_INDEX_NOTE } : {}),
      };

      response.status(200).json(payload);
    }),
  );

  return router;
}
