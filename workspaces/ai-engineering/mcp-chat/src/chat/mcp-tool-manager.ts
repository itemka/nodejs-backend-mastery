import type {
  LlmCustomToolDefinition,
  LlmToolInputSchema,
  LlmToolResultBlock,
  LlmToolUseBlock,
} from '@workspaces/packages/llm-client';

import type { McpCallToolResult, McpStdioClient, McpTool } from '../client/mcp-client.js';

export interface RegisteredMcpClient {
  readonly client: McpStdioClient;
  readonly name: string;
  readonly tools: readonly McpTool[];
}

export interface McpToolManager {
  readonly clients: readonly RegisteredMcpClient[];
  callTool(toolUse: LlmToolUseBlock): Promise<LlmToolResultBlock>;
  toolDefinitions(): readonly LlmCustomToolDefinition[];
}

function toLlmInputSchema(schema: McpTool['inputSchema']): LlmToolInputSchema {
  const { properties, required, type, ...rest } = schema;
  void type;

  return {
    type: 'object',
    ...rest,
    ...(properties === undefined ? {} : { properties }),
    ...(required === undefined ? {} : { required }),
  };
}

function toLlmToolDefinitions(tools: readonly McpTool[]): readonly LlmCustomToolDefinition[] {
  return tools.map((tool) => ({
    ...(tool.description === undefined ? {} : { description: tool.description }),
    inputSchema: toLlmInputSchema(tool.inputSchema),
    name: tool.name,
  }));
}

function callToolResultToToolResultBlock(
  toolUseId: string,
  result: McpCallToolResult,
): LlmToolResultBlock {
  const textChunks: string[] = [];

  for (const block of result.content) {
    if (block.type === 'text') {
      textChunks.push(block.text);
    } else if (block.type === 'resource' && 'text' in block.resource) {
      textChunks.push(block.resource.text);
    } else {
      textChunks.push(`[unsupported tool content type: ${block.type}]`);
    }
  }

  if (result.structuredContent !== undefined && textChunks.length === 0) {
    textChunks.push(JSON.stringify(result.structuredContent));
  }

  const content = textChunks.length > 0 ? textChunks.join('\n') : '(empty tool result)';
  const isError = result.isError === true;

  return {
    content,
    tool_use_id: toolUseId,
    type: 'tool_result',
    ...(isError ? { is_error: true } : {}),
  };
}

export interface CreateMcpToolManagerOptions {
  readonly clients: readonly {
    readonly client: McpStdioClient;
    readonly name: string;
  }[];
}

export async function createMcpToolManager(
  options: CreateMcpToolManagerOptions,
): Promise<McpToolManager> {
  const registered: RegisteredMcpClient[] = [];
  const seenNames = new Set<string>();

  for (const entry of options.clients) {
    const tools = await entry.client.listTools();

    for (const tool of tools) {
      if (seenNames.has(tool.name)) {
        throw new Error(
          `MCP tool "${tool.name}" is registered by more than one server. Tool names must be unique.`,
        );
      }

      seenNames.add(tool.name);
    }

    registered.push({ client: entry.client, name: entry.name, tools });
  }

  const ownerByTool = new Map<string, RegisteredMcpClient>();

  for (const entry of registered) {
    for (const tool of entry.tools) {
      ownerByTool.set(tool.name, entry);
    }
  }

  return {
    async callTool(toolUse) {
      const owner = ownerByTool.get(toolUse.name);

      if (owner === undefined) {
        return {
          content: `Unknown MCP tool: ${toolUse.name}`,
          is_error: true,
          tool_use_id: toolUse.id,
          type: 'tool_result',
        };
      }

      try {
        const result = await owner.client.callTool(
          toolUse.name,
          (toolUse.input as Record<string, unknown> | null) ?? {},
        );

        return callToolResultToToolResultBlock(toolUse.id, result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        return {
          content: `MCP tool "${toolUse.name}" threw: ${message}`,
          is_error: true,
          tool_use_id: toolUse.id,
          type: 'tool_result',
        };
      }
    },
    clients: registered,
    toolDefinitions() {
      return registered.flatMap((entry) => toLlmToolDefinitions(entry.tools));
    },
  };
}
