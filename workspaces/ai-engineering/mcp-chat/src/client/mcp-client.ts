import {
  Client,
  StdioClientTransport,
  type StdioServerParameters,
} from '@modelcontextprotocol/client';
import * as ui from '@workspaces/cli-output';

export const CLIENT_NAME = 'mcp-chat-client';
export const CLIENT_VERSION = '0.1.0';

export type McpTool = Awaited<ReturnType<Client['listTools']>>['tools'][number];
export type McpResource = Awaited<ReturnType<Client['listResources']>>['resources'][number];
export type McpResourceTemplate = Awaited<
  ReturnType<Client['listResourceTemplates']>
>['resourceTemplates'][number];
export type McpPrompt = Awaited<ReturnType<Client['listPrompts']>>['prompts'][number];
export type McpCallToolResult = Awaited<ReturnType<Client['callTool']>>;
export type McpReadResourceResult = Awaited<ReturnType<Client['readResource']>>;
export type McpGetPromptResult = Awaited<ReturnType<Client['getPrompt']>>;

export interface McpStdioClient {
  callTool(name: string, args: Record<string, unknown>): Promise<McpCallToolResult>;
  close(): Promise<void>;
  getPrompt(name: string, args?: Record<string, string>): Promise<McpGetPromptResult>;
  listPrompts(): Promise<readonly McpPrompt[]>;
  listResources(): Promise<readonly McpResource[]>;
  listResourceTemplates(): Promise<readonly McpResourceTemplate[]>;
  listTools(): Promise<readonly McpTool[]>;
  readResource(uri: string): Promise<McpReadResourceResult>;
}

export interface ConnectMcpStdioClientOptions {
  readonly clientName?: string;
  readonly clientVersion?: string;
  readonly server: StdioServerParameters;
}

async function paginate<T>(
  fetchPage: (
    cursor: string | undefined,
  ) => Promise<{ items: readonly T[]; nextCursor: string | undefined }>,
): Promise<readonly T[]> {
  const collected: T[] = [];
  let cursor: string | undefined;

  do {
    const page = await fetchPage(cursor);
    collected.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== undefined && cursor !== '');

  return collected;
}

export async function connectMcpStdioClient(
  options: ConnectMcpStdioClientOptions,
): Promise<McpStdioClient> {
  const client = new Client({
    name: options.clientName ?? CLIENT_NAME,
    version: options.clientVersion ?? CLIENT_VERSION,
  });
  const transport = new StdioClientTransport(options.server);

  await client.connect(transport);

  return {
    async callTool(name, args) {
      return client.callTool({ arguments: args, name });
    },
    async close() {
      try {
        await client.close();
      } catch (error) {
        console.error(`${ui.prefix('[mcp-client]')} ${ui.error('error closing client:')}`, error);
      }

      try {
        await transport.close();
      } catch (error) {
        console.error(
          `${ui.prefix('[mcp-client]')} ${ui.error('error closing transport:')}`,
          error,
        );
      }
    },
    async getPrompt(name, args) {
      return client.getPrompt({ arguments: args ?? {}, name });
    },
    async listPrompts() {
      return paginate<McpPrompt>(async (cursor) => {
        const params = cursor === undefined ? undefined : { cursor };
        const page = await client.listPrompts(params);

        return { items: page.prompts, nextCursor: page.nextCursor };
      });
    },
    async listResources() {
      return paginate<McpResource>(async (cursor) => {
        const params = cursor === undefined ? undefined : { cursor };
        const page = await client.listResources(params);

        return { items: page.resources, nextCursor: page.nextCursor };
      });
    },
    async listResourceTemplates() {
      return paginate<McpResourceTemplate>(async (cursor) => {
        const params = cursor === undefined ? undefined : { cursor };
        const page = await client.listResourceTemplates(params);

        return { items: page.resourceTemplates, nextCursor: page.nextCursor };
      });
    },
    async listTools() {
      return paginate<McpTool>(async (cursor) => {
        const params = cursor === undefined ? undefined : { cursor };
        const page = await client.listTools(params);

        return { items: page.tools, nextCursor: page.nextCursor };
      });
    },
    async readResource(uri) {
      return client.readResource({ uri });
    },
  };
}
