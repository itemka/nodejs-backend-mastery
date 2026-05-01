import { describe, expect, it } from 'vitest';

import { addAssistantMessage, addUserMessage } from '../../src/chat/history.js';
import type { Messages } from '../../src/chat/types.js';
import { runChatbot } from '../../src/cli/run-chatbot.js';

describe('runChatbot', () => {
  it('repeats until input stops', async () => {
    const prompts: string[] = [];
    const outputs: string[] = [];
    const userInputs = ['Hello', 'Write another sentence'];
    const requests: Messages[] = [];

    const messages = await runChatbot({
      debugResponse: true,
      input: (prompt) => {
        prompts.push(prompt);
        const nextInput = userInputs.shift();

        if (nextInput === undefined) {
          throw new Error('No more input');
        }

        return Promise.resolve(nextInput);
      },
      maxTokens: 50,
      output: (text) => {
        outputs.push(text);
      },
      outputFormat: {
        assistantPrefill: '{',
        responseSuffix: '}',
        stopSequences: ['}'],
      },
      runTurn: (messages, text, options) => {
        expect(options.maxTokens).toBe(50);
        expect(options.debugResponse).toBe(true);
        expect(options.stream).toBe(true);
        expect(options.onTextDelta).toEqual(expect.any(Function));
        expect(options.outputFormat).toEqual({
          assistantPrefill: '{',
          responseSuffix: '}',
          stopSequences: ['}'],
        });

        const answer = `Answer to: ${text}`;
        addUserMessage(messages, text);
        requests.push(messages.map((message) => ({ ...message })));
        addAssistantMessage(messages, answer);

        return Promise.resolve(answer);
      },
    });

    expect(prompts).toEqual(['> ', '> ', '> ']);
    expect(requests).toEqual([
      [{ content: 'Hello', role: 'user' }],
      [
        { content: 'Hello', role: 'user' },
        { content: 'Answer to: Hello', role: 'assistant' },
        { content: 'Write another sentence', role: 'user' },
      ],
    ]);

    expect(outputs).toEqual(['Answer to: Hello', 'Answer to: Write another sentence', '']);
    expect(messages).toEqual([
      { content: 'Hello', role: 'user' },
      { content: 'Answer to: Hello', role: 'assistant' },
      { content: 'Write another sentence', role: 'user' },
      {
        content: 'Answer to: Write another sentence',
        role: 'assistant',
      },
    ]);
  });

  it('outputs streamed chunks and does not duplicate the final answer', async () => {
    const outputs: string[] = [];
    const chunks: string[] = [];
    const userInputs = ['Hello'];

    await runChatbot({
      input: () => {
        const nextInput = userInputs.shift();

        if (nextInput === undefined) {
          throw new Error('No more input');
        }

        return Promise.resolve(nextInput);
      },
      output: (text) => {
        outputs.push(text);
      },
      outputChunk: (text) => {
        chunks.push(text);
      },
      runTurn: (messages, text, options) => {
        addUserMessage(messages, text);
        options.onTextDelta?.('Hel');
        options.onTextDelta?.('lo');
        addAssistantMessage(messages, 'Hello');

        return Promise.resolve('Hello');
      },
    });

    expect(chunks).toEqual(['Hel', 'lo']);
    expect(outputs).toEqual(['', '']);
  });
});
