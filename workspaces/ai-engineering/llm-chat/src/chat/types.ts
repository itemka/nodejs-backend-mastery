import type { OutputFormatConfig, TextDeltaHandler } from '../llm/types.js';

export interface ChatMessage {
  content: string;
  role: 'user' | 'assistant';
}

export type Messages = ChatMessage[];

export interface ChatOptions {
  debugResponse?: boolean;
  maxTokens?: number;
  onTextDelta?: TextDeltaHandler;
  outputFormat?: OutputFormatConfig;
  stream?: boolean;
}
