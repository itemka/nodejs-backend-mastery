import { Client } from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';

import { connectMcpStdioClient } from '../../src/client/mcp-client.js';
import { createDocumentStore } from '../../src/documents/document-store.js';
import { createDocumentMcpServer } from '../../src/server/document-mcp-server.js';
import { createPairedTransports } from '../support/in-memory-transport.js';

async function buildInMemoryClient() {
  const store = createDocumentStore({ 'a.md': 'aaa', 'b.md': 'bbb', 'c.md': 'ccc' });
  const server = createDocumentMcpServer(store);
  const { clientTransport, serverTransport } = createPairedTransports();
  await server.connect(serverTransport);
  const client = new Client({ name: 'paginate-client', version: '0.0.0' });
  await client.connect(clientTransport);

  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

describe('mcp client wrapper', () => {
  it('lists tools, resources, resource templates, and prompts', async () => {
    const { client, close } = await buildInMemoryClient();

    try {
      const toolsResult = await client.listTools();
      const toolNames = toolsResult.tools.map((tool) => tool.name).toSorted();
      expect(toolNames).toEqual(['edit_document', 'read_doc_contents']);

      const resourcesResult = await client.listResources();
      expect(resourcesResult.resources.map((resource) => resource.uri)).toContain(
        'docs://documents',
      );

      const templatesResult = await client.listResourceTemplates();
      expect(templatesResult.resourceTemplates.map((template) => template.uriTemplate)).toContain(
        'docs://documents/{doc_id}',
      );

      const promptsResult = await client.listPrompts();
      expect(promptsResult.prompts.map((prompt) => prompt.name)).toContain('format');
    } finally {
      await close();
    }
  });

  it('exposes connectMcpStdioClient for stdio connections', () => {
    expect(typeof connectMcpStdioClient).toBe('function');
  });
});
