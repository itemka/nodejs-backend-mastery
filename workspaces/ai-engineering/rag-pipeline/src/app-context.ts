import type { AppEnv } from './config/env.js';
import type { Retriever } from './retrieval/retriever.js';
import type { Logger } from './shared/logger.js';

export interface AppContext {
  readonly allowedDocumentRoot: string;
  readonly env: AppEnv;
  readonly logger: Logger;
  readonly retriever: Retriever;
}
