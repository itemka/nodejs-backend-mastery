import { Client } from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';

import { createDocumentStore } from '../../src/documents/document-store.js';
import {
  DOCUMENTS_LIST_URI,
  createDocumentMcpServer,
} from '../../src/server/document-mcp-server.js';
import { createPairedTransports } from '../support/in-memory-transport.js';

const seed = {
  'a.md': 'Hello world',
  'b.md': 'one two three',
} as const;

async function connectInMemory(): Promise<{ client: Client; close: () => Promise<void> }> {
  const store = createDocumentStore(seed);
  const server = createDocumentMcpServer(store);
  const { clientTransport, serverTransport } = createPairedTransports();

  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);

  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

describe('document MCP server', () => {
  it('lists registered tools', async () => {
    const { client, close } = await connectInMemory();

    try {
      const { tools } = await client.listTools();
      const names = tools.map((tool) => tool.name).toSorted();

      expect(names).toEqual(['edit_document', 'read_doc_contents']);
    } finally {
      await close();
    }
  });

  it('reads a document via the read_doc_contents tool', async () => {
    const { client, close } = await connectInMemory();

    try {
      const result = await client.callTool({
        arguments: { doc_id: 'a.md' },
        name: 'read_doc_contents',
      });

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({
        content: 'Hello world',
        doc_id: 'a.md',
      });
    } finally {
      await close();
    }
  });

  it('returns isError=true for a missing document', async () => {
    const { client, close } = await connectInMemory();

    try {
      const result = await client.callTool({
        arguments: { doc_id: 'missing.md' },
        name: 'read_doc_contents',
      });

      expect(result.isError).toBe(true);
    } finally {
      await close();
    }
  });

  it('edits a document via edit_document', async () => {
    const { client, close } = await connectInMemory();

    try {
      const result = await client.callTool({
        arguments: { doc_id: 'a.md', new_str: 'planet', old_str: 'world' },
        name: 'edit_document',
      });

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({
        doc_id: 'a.md',
        replacements: 1,
        updated: true,
      });

      const after = await client.callTool({
        arguments: { doc_id: 'a.md' },
        name: 'read_doc_contents',
      });

      expect(after.structuredContent).toMatchObject({ content: 'Hello planet' });
    } finally {
      await close();
    }
  });

  it('returns isError=true when edit_document old_str is missing', async () => {
    const { client, close } = await connectInMemory();

    try {
      const result = await client.callTool({
        arguments: { doc_id: 'a.md', new_str: 'x', old_str: 'nope' },
        name: 'edit_document',
      });

      expect(result.isError).toBe(true);
    } finally {
      await close();
    }
  });

  it('lists documents through the docs://documents resource', async () => {
    const { client, close } = await connectInMemory();

    try {
      const result = await client.readResource({ uri: DOCUMENTS_LIST_URI });
      const first = result.contents[0];

      expect(first).toBeDefined();
      expect(first?.mimeType).toBe('application/json');
      const payload = JSON.parse((first as { text: string }).text) as { documents: string[] };
      expect(payload.documents.toSorted()).toEqual(['a.md', 'b.md']);
    } finally {
      await close();
    }
  });

  it('reads an individual document via the template URI', async () => {
    const { client, close } = await connectInMemory();

    try {
      const result = await client.readResource({ uri: 'docs://documents/b.md' });
      const first = result.contents[0];

      expect((first as { text: string }).text).toBe('one two three');
    } finally {
      await close();
    }
  });

  it('lists prompts including format', async () => {
    const { client, close } = await connectInMemory();

    try {
      const { prompts } = await client.listPrompts();

      expect(prompts.map((p) => p.name)).toContain('format');
    } finally {
      await close();
    }
  });

  it('returns format prompt messages with the doc_id reference', async () => {
    const { client, close } = await connectInMemory();

    try {
      const result = await client.getPrompt({ arguments: { doc_id: 'a.md' }, name: 'format' });
      const first = result.messages[0];

      expect(first?.role).toBe('user');

      if (first?.content.type === 'text') {
        expect(first.content.text).toMatch(/a\.md/);
      } else {
        throw new Error('expected first message to be text content');
      }
    } finally {
      await close();
    }
  });
});
