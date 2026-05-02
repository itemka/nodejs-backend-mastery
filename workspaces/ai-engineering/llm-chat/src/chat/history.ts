import type { Messages } from './types.js';

export function addUserMessage(messages: Messages, text: string): void {
  messages.push({ content: text, role: 'user' });
}

export function addAssistantMessage(messages: Messages, text: string): void {
  messages.push({ content: text, role: 'assistant' });
}
