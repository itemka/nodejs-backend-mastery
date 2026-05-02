import type { Messages } from '../chat/types.js';

export type TextDeltaHandler = (text: string) => void;

export interface OutputFormatConfig {
  readonly assistantPrefill?: string;
  readonly instructions?: string;
  readonly jsonSchema?: Record<string, unknown>;
  readonly responseSuffix?: string;
  readonly stopSequences?: readonly string[];
}

export interface LlmRequest {
  readonly maxTokens: number;
  readonly messages: Messages;
  readonly model: string;
  readonly onTextDelta?: TextDeltaHandler;
  readonly outputFormat?: OutputFormatConfig;
  readonly stream?: boolean;
  readonly systemPrompt?: string;
  readonly temperature?: number;
}

export interface LlmResponse {
  readonly raw: unknown;
  readonly text: string;
}

export interface LlmProvider {
  createMessage(request: LlmRequest): Promise<LlmResponse>;
}
