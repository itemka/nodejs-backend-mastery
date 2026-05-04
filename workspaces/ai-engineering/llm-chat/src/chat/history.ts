import type { LlmContentBlock, LlmToolResultBlock } from '@workspaces/packages/llm-client';

import type { Messages } from './types.js';

export function addUserMessage(messages: Messages, text: string): void {
  messages.push({ content: text, role: 'user' });
}

export function addAssistantMessage(messages: Messages, text: string): void {
  messages.push({ content: text, role: 'assistant' });
}

export function addAssistantContent(messages: Messages, content: readonly LlmContentBlock[]): void {
  messages.push({ content, role: 'assistant' });
}

export function addUserToolResultMessage(
  messages: Messages,
  toolResults: readonly LlmToolResultBlock[],
): void {
  messages.push({ content: [...toolResults], role: 'user' });
}
