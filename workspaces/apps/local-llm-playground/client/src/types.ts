import type { CompareResult, LlmCheckerCommandResponse } from '../../shared/api.js';
import type { SupportedModelId } from '../../shared/models.js';

export interface PlaygroundSettings {
  compareModelIds: SupportedModelId[];
  maxTokens: number;
  model?: SupportedModelId;
  stream: boolean;
  systemPrompt: string;
  temperature: number;
  userPrompt: string;
}

export interface ChatUiState {
  error?: string;
  latencyMs?: number;
  requestId?: string;
  responseText: string;
  status: 'error' | 'idle' | 'loading' | 'streaming' | 'success';
}

export interface CompareUiState {
  error?: string;
  results: CompareResult[];
  status: 'error' | 'idle' | 'loading' | 'success';
}

export interface CheckerSectionState {
  data?: LlmCheckerCommandResponse;
  error?: string;
  status: 'error' | 'idle' | 'loading' | 'success';
}

export type WorkspaceView = 'chat' | 'checker' | 'compare';

export type CheckerSectionKey =
  | 'check'
  | 'codingRecommendation'
  | 'installed'
  | 'ollamaPlan'
  | 'reasoningRecommendation';
