import { describe, expect, it } from 'vitest';

import {
  buildUserTextWithContext,
  extractDocumentMentions,
  listKnownDocumentIds,
  resolveMentions,
} from '../../src/chat/document-context.js';
import type { McpStdioClient } from '../../src/client/mcp-client.js';

function fakeClient(documents: Record<string, string>): McpStdioClient {
  return {
    callTool: () =>
      Promise.resolve({ content: [] } as unknown as Awaited<
        ReturnType<McpStdioClient['callTool']>
      >),
    close: () => Promise.resolve(),
    getPrompt: () =>
      Promise.resolve({ messages: [] } as unknown as Awaited<
        ReturnType<McpStdioClient['getPrompt']>
      >),
    listPrompts: () => Promise.resolve([]),
    listResources: () => Promise.resolve([]),
    listResourceTemplates: () => Promise.resolve([]),
    listTools: () => Promise.resolve([]),
    readResource: (uri: string) => {
      if (uri === 'docs://documents') {
        return Promise.resolve({
          contents: [
            {
              mimeType: 'application/json',
              text: JSON.stringify({ documents: Object.keys(documents) }),
              uri,
            },
          ],
        } as unknown as Awaited<ReturnType<McpStdioClient['readResource']>>);
      }

      const docId = uri.replace('docs://documents/', '');
      const text = documents[docId];

      if (text === undefined) {
        return Promise.reject(new Error(`Unknown document: ${docId}`));
      }

      return Promise.resolve({
        contents: [{ mimeType: 'text/plain', text, uri }],
      } as unknown as Awaited<ReturnType<McpStdioClient['readResource']>>);
    },
  };
}

describe('document context', () => {
  it('extracts unique document mentions preserving order', () => {
    expect(extractDocumentMentions('see @a.md and @b.md plus @a.md again')).toEqual([
      'a.md',
      'b.md',
    ]);
  });

  it('ignores sentence-final periods after document mentions', () => {
    expect(extractDocumentMentions('please compare @a.md. Then read @b.md...')).toEqual([
      'a.md',
      'b.md',
    ]);
  });

  it('ignores text without mentions', () => {
    expect(extractDocumentMentions('no mentions here')).toEqual([]);
  });

  it('lists known document ids from the resource', async () => {
    const client = fakeClient({ 'a.md': '1', 'b.md': '2' });

    expect(await listKnownDocumentIds(client)).toEqual(['a.md', 'b.md']);
  });

  it('returns matching snippets and unknown ids', async () => {
    const client = fakeClient({ 'a.md': 'alpha', 'b.md': 'beta' });
    const result = await resolveMentions(client, 'compare @a.md and @missing.md');

    expect(result.snippets).toEqual([{ content: 'alpha', docId: 'a.md' }]);
    expect(result.unknown).toEqual(['missing.md']);
  });

  it('resolves document mentions followed by sentence punctuation', async () => {
    const client = fakeClient({ 'a.md': 'alpha' });
    const result = await resolveMentions(client, 'summarize @a.md.');

    expect(result.snippets).toEqual([{ content: 'alpha', docId: 'a.md' }]);
    expect(result.unknown).toEqual([]);
  });

  it('returns empty result when no mentions present', async () => {
    const client = fakeClient({ 'a.md': 'alpha' });
    const result = await resolveMentions(client, 'no mentions');

    expect(result.snippets).toEqual([]);
    expect(result.unknown).toEqual([]);
  });

  it('builds user text with referenced documents inline', () => {
    const text = buildUserTextWithContext('please summarize', [
      { content: 'alpha\nbeta', docId: 'a.md' },
    ]);

    expect(text).toContain('<document id="a.md">');
    expect(text).toContain('alpha\nbeta');
    expect(text).toContain('User message:\nplease summarize');
  });

  it('returns the bare user text when there are no snippets', () => {
    expect(buildUserTextWithContext('hello', [])).toBe('hello');
  });
});
