import type { EvalResult, EvalSummary } from '../eval/types.js';

export interface RunMetadata {
  readonly concurrency: number;
  readonly datasetPath: string;
  readonly finishedAt: string;
  readonly model: string;
  readonly startedAt: string;
  readonly templateName: string;
}

export interface ReportPayload {
  readonly metadata: RunMetadata;
  readonly passScore: number;
  readonly results: readonly EvalResult[];
  readonly summary: EvalSummary;
}

export type ReportFormat = 'html' | 'json';
