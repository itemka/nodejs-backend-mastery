import type { LlmToolResultBlock, LlmToolUseBlock } from '@workspaces/packages/llm-client';

import { findToolByName } from './registry.js';
import type { AppTool, AppToolExecutionContext } from './types.js';

const MAX_ERROR_MESSAGE_LENGTH = 200;

function sanitizeError(error: unknown): string {
  const message =
    error instanceof Error && error.message.trim() !== ''
      ? error.message
      : 'Tool execution failed.';
  const firstLine = message.split('\n')[0] ?? 'Tool execution failed.';

  return firstLine.slice(0, MAX_ERROR_MESSAGE_LENGTH);
}

function serializeToolResult(content: unknown): string {
  return JSON.stringify(content);
}

function createErrorResult(toolUseId: string, message: string): LlmToolResultBlock {
  return {
    content: serializeToolResult({ error: message }),
    is_error: true,
    tool_use_id: toolUseId,
    type: 'tool_result',
  };
}

export async function executeToolUse(
  toolUse: LlmToolUseBlock,
  tools: readonly AppTool[],
  context: AppToolExecutionContext,
): Promise<LlmToolResultBlock> {
  const tool = findToolByName(tools, toolUse.name);

  if (tool === undefined) {
    return createErrorResult(toolUse.id, `Unknown tool: ${toolUse.name}.`);
  }

  try {
    const result = await tool.execute(toolUse.input, context);

    return {
      content: serializeToolResult(result),
      tool_use_id: toolUse.id,
      type: 'tool_result',
    };
  } catch (error) {
    return createErrorResult(toolUse.id, sanitizeError(error));
  }
}
