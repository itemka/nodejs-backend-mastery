import { Router } from 'express';

import type { AppContext } from '../app-context.js';
import { chunkByCharacters } from '../chunking/chunk-by-characters.js';
import { chunkBySections } from '../chunking/chunk-by-sections.js';
import { chunkBySentences } from '../chunking/chunk-by-sentences.js';
import { loadMarkdownDocument } from '../documents/load-markdown.js';
import type { IngestResponse } from '../shared/api.js';
import { ingestRequestSchema } from '../shared/api.js';
import { asyncHandler } from '../shared/async-handler.js';
import type { DocumentChunk } from '../shared/types.js';

const CHARACTER_CHUNK_SIZE = 1200;
const CHARACTER_CHUNK_OVERLAP = 200;
const SENTENCE_CHUNK_SIZE = 6;
const SENTENCE_CHUNK_OVERLAP = 1;

function buildChunks(
  strategy: 'characters' | 'sections' | 'sentences',
  document: { content: string; documentId: string; sourceName: string; sourcePath: string },
): DocumentChunk[] {
  if (strategy === 'characters') {
    return chunkByCharacters(document.content, CHARACTER_CHUNK_SIZE, CHARACTER_CHUNK_OVERLAP).map(
      (chunk) => ({
        chunkId: `${document.documentId}#c${chunk.index}`,
        chunkIndex: chunk.index,
        content: chunk.content,
        documentId: document.documentId,
        sourceName: document.sourceName,
        sourcePath: document.sourcePath,
      }),
    );
  }

  if (strategy === 'sentences') {
    return chunkBySentences(document.content, SENTENCE_CHUNK_SIZE, SENTENCE_CHUNK_OVERLAP).map(
      (chunk) => ({
        chunkId: `${document.documentId}#s${chunk.index}`,
        chunkIndex: chunk.index,
        content: chunk.content,
        documentId: document.documentId,
        sourceName: document.sourceName,
        sourcePath: document.sourcePath,
      }),
    );
  }

  return chunkBySections(document.content).map((chunk) => ({
    chunkId: `${document.documentId}#sec${chunk.index}`,
    chunkIndex: chunk.index,
    content: chunk.content,
    documentId: document.documentId,
    ...(chunk.sectionTitle === undefined ? {} : { sectionTitle: chunk.sectionTitle }),
    sourceName: document.sourceName,
    sourcePath: document.sourcePath,
  }));
}

export function createIngestRouter(context: AppContext): Router {
  const router = Router();

  router.post(
    '/',
    asyncHandler(async (request, response) => {
      const body = ingestRequestSchema.parse(request.body ?? {});
      const document = await loadMarkdownDocument({
        allowedRoot: context.allowedDocumentRoot,
        ...(body.sourcePath === undefined ? {} : { relativePath: body.sourcePath }),
      });

      const chunks = buildChunks(body.strategy, document);
      const embedded = await context.retriever.ingest({ chunks });
      const sizes = context.retriever.sizes();
      const payload: IngestResponse = {
        chunkCount: embedded.length,
        documentId: document.documentId,
        indexSizes: sizes,
        sourceName: document.sourceName,
        sourcePath: document.sourcePath,
        strategy: body.strategy,
      };

      context.logger.info('rag.ingest_complete', {
        chunkCount: embedded.length,
        documentId: document.documentId,
        strategy: body.strategy,
      });
      response.status(200).json(payload);
    }),
  );

  return router;
}
