import type { ChatMessage } from '@workspaces/packages/llm-client';
import { describe, expect, it } from 'vitest';

import type { ChatSession } from '../../src/chat/chat-session.js';
import type { ChatOptions, Messages } from '../../src/chat/types.js';
import { runChatbot } from '../../src/cli/run-chatbot.js';
import type { McpStdioClient } from '../../src/client/mcp-client.js';

const noop = (_text: string): void => {
  void _text;
};

function fakeDocumentServer(documents: Record<string, string>): McpStdioClient {
  return {
    callTool: () =>
      Promise.resolve({ content: [] } as unknown as Awaited<
        ReturnType<McpStdioClient['callTool']>
      >),
    close: () => Promise.resolve(),
    getPrompt: (name, args) => {
      if (name !== 'format') {
        return Promise.reject(new Error(`Unknown prompt: ${name}`));
      }

      const docId = args?.doc_id ?? 'unknown';

      return Promise.resolve({
        messages: [
          {
            content: { text: `format ${docId}`, type: 'text' },
            role: 'user',
          },
        ],
      } as unknown as Awaited<ReturnType<McpStdioClient['getPrompt']>>);
    },
    listPrompts: () =>
      Promise.resolve([
        {
          arguments: [{ name: 'doc_id', required: true }],
          description: 'Format a document',
          name: 'format',
        },
      ] as unknown as Awaited<ReturnType<McpStdioClient['listPrompts']>>),
    listResources: () =>
      Promise.resolve([] as unknown as Awaited<ReturnType<McpStdioClient['listResources']>>),
    listResourceTemplates: () =>
      Promise.resolve(
        [] as unknown as Awaited<ReturnType<McpStdioClient['listResourceTemplates']>>,
      ),
    listTools: () =>
      Promise.resolve([] as unknown as Awaited<ReturnType<McpStdioClient['listTools']>>),
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

function fakeSession(): {
  appended: ChatMessage[];
  messages: { options: ChatOptions; text: string }[];
  session: ChatSession;
} {
  const history: Messages = [];
  const appended: ChatMessage[] = [];
  const messages: { options: ChatOptions; text: string }[] = [];
  const session: ChatSession = {
    appendMessages: (msgs) => {
      appended.push(...msgs);
      history.push(...msgs);
    },
    get history() {
      return history;
    },
    sendUserMessage: (text, options = {}) => {
      messages.push({ options, text });
      history.push({ content: text, role: 'user' });
      const answer = `echo: ${text}`;
      history.push({ content: answer, role: 'assistant' });

      return Promise.resolve(answer);
    },
  };

  return { appended, messages, session };
}

function streamingToolSession(): ChatSession {
  const history: Messages = [];

  return {
    appendMessages: (messages) => {
      history.push(...messages);
    },
    get history() {
      return history;
    },
    sendUserMessage: (text, options = {}) => {
      history.push({ content: text, role: 'user' });
      options.onTextDelta?.('partial response');
      options.onToolEvent?.({ toolName: 'read_doc_contents', type: 'tool_running' });
      history.push({ content: 'done', role: 'assistant' });

      return Promise.resolve('done');
    },
  };
}

function scriptInput(turns: readonly string[]): () => Promise<string> {
  const queue = [...turns];

  return () => {
    const next = queue.shift();

    if (next === undefined) {
      return Promise.reject(new Error('input closed'));
    }

    return Promise.resolve(next);
  };
}

describe('runChatbot', () => {
  it('handles a plain user turn and prints the answer when not streaming', async () => {
    const documentServer = fakeDocumentServer({});
    const { messages, session } = fakeSession();
    const outputs: string[] = [];

    await runChatbot({
      documentServer,
      input: scriptInput(['hi']),
      output: (text) => outputs.push(text),
      outputChunk: noop,
      session,
      stream: false,
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]?.text).toBe('hi');
    expect(outputs).toContain('echo: hi');
  });

  it('lists prompts when the user submits "/"', async () => {
    const documentServer = fakeDocumentServer({});
    const { messages, session } = fakeSession();
    const outputs: string[] = [];

    await runChatbot({
      documentServer,
      input: scriptInput(['/']),
      output: (text) => outputs.push(text),
      outputChunk: noop,
      session,
    });

    expect(messages).toHaveLength(0);
    expect(outputs.some((line) => line.includes('/format'))).toBe(true);
  });

  it('lists documents when the user submits "@"', async () => {
    const documentServer = fakeDocumentServer({ 'a.md': 'x', 'b.md': 'y' });
    const { messages, session } = fakeSession();
    const outputs: string[] = [];

    await runChatbot({
      documentServer,
      input: scriptInput(['@']),
      output: (text) => outputs.push(text),
      outputChunk: noop,
      session,
    });

    expect(messages).toHaveLength(0);
    expect(outputs.some((line) => line.includes('@a.md') && line.includes('@b.md'))).toBe(true);
  });

  it('runs /format doc_id by routing through the prompt', async () => {
    const documentServer = fakeDocumentServer({ 'a.md': 'alpha' });
    const { messages, session } = fakeSession();

    await runChatbot({
      documentServer,
      input: scriptInput(['/format a.md']),
      output: noop,
      outputChunk: noop,
      session,
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]?.text).toBe('format a.md');
  });

  it('rejects /format without doc_id', async () => {
    const documentServer = fakeDocumentServer({});
    const { messages, session } = fakeSession();
    const outputs: string[] = [];

    await runChatbot({
      documentServer,
      input: scriptInput(['/format']),
      output: (text) => outputs.push(text),
      outputChunk: noop,
      session,
    });

    expect(messages).toHaveLength(0);
    expect(outputs.some((line) => line.includes('requires argument'))).toBe(true);
  });

  it('injects document context when the user mentions @doc', async () => {
    const documentServer = fakeDocumentServer({ 'a.md': 'alpha content' });
    const { messages, session } = fakeSession();

    await runChatbot({
      documentServer,
      input: scriptInput(['please read @a.md']),
      output: noop,
      outputChunk: noop,
      session,
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]?.text).toContain('<document id="a.md">');
    expect(messages[0]?.text).toContain('alpha content');
    expect(messages[0]?.text).toContain('please read @a.md');
  });

  it('warns about unknown @doc mentions but still runs the turn', async () => {
    const documentServer = fakeDocumentServer({ 'a.md': 'alpha' });
    const { messages, session } = fakeSession();
    const outputs: string[] = [];

    await runChatbot({
      documentServer,
      input: scriptInput(['ask about @missing.md']),
      output: (text) => outputs.push(text),
      outputChunk: noop,
      session,
    });

    expect(messages).toHaveLength(1);
    expect(outputs.some((line) => line.includes('Unknown document'))).toBe(true);
  });

  it('passes onTextDelta and onToolEvent through to chat options', async () => {
    const documentServer = fakeDocumentServer({});
    const { messages, session } = fakeSession();

    await runChatbot({
      documentServer,
      input: scriptInput(['hi']),
      output: noop,
      outputChunk: noop,
      session,
    });

    expect(messages[0]?.options.onTextDelta).toBeDefined();
    expect(messages[0]?.options.onToolEvent).toBeDefined();
    expect(messages[0]?.options.stream).toBe(true);
  });

  it('prints a line break before tool status after streamed text', async () => {
    const documentServer = fakeDocumentServer({});
    const outputs: string[] = [];
    const chunks: string[] = [];

    await runChatbot({
      documentServer,
      input: scriptInput(['hi']),
      output: (text) => outputs.push(text),
      outputChunk: (text) => chunks.push(text),
      session: streamingToolSession(),
    });

    expect(chunks).toEqual(['partial response']);
    expect(outputs).toContain('');
    expect(outputs).toContain('[tool] Running read_doc_contents');
  });
});
