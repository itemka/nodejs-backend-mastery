import type { ChatMessage } from '@workspaces/packages/llm-client';

import type { McpGetPromptResult } from '../client/mcp-client.js';

export function mcpPromptToChatMessages(prompt: McpGetPromptResult): ChatMessage[] {
  const messages: ChatMessage[] = [];

  for (const message of prompt.messages) {
    const block = message.content;

    if (block.type === 'text') {
      messages.push({ content: block.text, role: message.role });
      continue;
    }

    if (block.type === 'resource' && 'text' in block.resource) {
      messages.push({ content: block.resource.text, role: message.role });
      continue;
    }
  }

  return messages;
}
