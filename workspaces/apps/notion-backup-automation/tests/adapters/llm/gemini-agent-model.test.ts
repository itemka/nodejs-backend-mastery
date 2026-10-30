import { ApiError } from '@google/genai';
import type { GenerateContentParameters } from '@google/genai';
import { describe, expect, it } from 'vitest';

import type { GeminiClient } from '../../../src/adapters/llm/gemini-agent-model.js';
import {
  GeminiAgentModel,
  SUPERVISOR_INSTRUCTIONS,
  thinkingConfigFor,
} from '../../../src/adapters/llm/gemini-agent-model.js';
import { NOOP_SUMMARY, NoopAgentModel } from '../../../src/adapters/llm/noop-agent-model.js';
import { AGENT_CHECK_CONTEXT } from '../../../src/agent/agent-check.js';
import { AgentModelError, parseAgentDecision } from '../../../src/agent/agent-model.js';
import { createLogger } from '../../../src/shared/logger.js';
import { SecretValue } from '../../../src/shared/secret-value.js';
import { decision } from '../../support/agent.js';

const API_KEY = 'AIzaFakeGeminiKeyForTests000000000000000';

const logs: string[] = [];
const logger = createLogger({
  level: 'debug',
  sink: (_level, line) => {
    logs.push(line);
  },
});

type Response = Awaited<ReturnType<GeminiClient['generateContent']>>;

/** The SDK client as the adapter calls it: records each request, answers from a script. */
function stubClient(answer: () => Promise<Response>) {
  const requests: GenerateContentParameters[] = [];
  const client: GeminiClient = {
    generateContent: (params) => {
      requests.push(params);

      return answer();
    },
  };

  return { client, requests };
}

function textResponse(text: string, finishReason = 'STOP'): Response {
  return { candidates: [{ finishReason } as never], text } as Response;
}

function model(client: GeminiClient, name = 'gemini-2.5-flash') {
  return new GeminiAgentModel({ apiKey: new SecretValue(API_KEY), client, logger, model: name });
}

function failure(call: Promise<unknown>): Promise<AgentModelError> {
  return call.then(
    () => {
      throw new Error('Expected the call to fail');
    },
    (error: unknown) => {
      if (!(error instanceof AgentModelError)) {
        throw error;
      }

      return error;
    },
  );
}

describe('GeminiAgentModel with a stubbed SDK', () => {
  it('asks for one schema-constrained JSON decision, deterministic and bounded', async () => {
    const answer = decision('notify_user', { summary: 'Update the Settings page object.' });
    const { client, requests } = stubClient(() =>
      Promise.resolve(textResponse(JSON.stringify(answer))),
    );
    const signal = new AbortController().signal;

    await expect(model(client).decide(AGENT_CHECK_CONTEXT, signal)).resolves.toEqual(answer);

    const [request] = requests;

    expect(request).toMatchObject({
      config: {
        abortSignal: signal,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
        systemInstruction: SUPERVISOR_INSTRUCTIONS,
        temperature: 0,
        thinkingConfig: { thinkingBudget: 0 },
      },
      model: 'gemini-2.5-flash',
    });
    expect(JSON.parse(request?.contents as string)).toEqual(AGENT_CHECK_CONTEXT);
    expect(request?.config?.responseJsonSchema).toMatchObject({
      properties: { action: { enum: expect.arrayContaining(['notify_user']) as unknown } },
    });
  });

  it('names itself after the provider and model', () => {
    expect(model(stubClient(() => Promise.reject(new Error('unused'))).client).id).toBe(
      'gemini:gemini-2.5-flash',
    );
  });

  it.each([
    [new ApiError({ message: 'quota', status: 429 }), 'rate_limited', 429],
    [new ApiError({ message: 'overloaded', status: 503 }), 'unavailable', 503],
    [new ApiError({ message: 'API key not valid', status: 400 }), 'unavailable', 400],
    [new TypeError('fetch failed'), 'unavailable', undefined],
  ] as const)('maps %s to %s', async (error, kind, status) => {
    const { client } = stubClient(() => {
      throw error;
    });
    const failed = await failure(
      model(client).decide(AGENT_CHECK_CONTEXT, new AbortController().signal),
    );

    expect(failed).toMatchObject({ failure: kind, status });
    // The SDK's message may echo the request; it never travels on.
    expect(failed.message).not.toContain('quota');
    expect(failed.message).not.toContain('API key');
  });

  it('reports an aborted call as a timeout', async () => {
    const controller = new AbortController();
    const { client } = stubClient(() => {
      controller.abort(new DOMException('timed out', 'TimeoutError'));

      return Promise.reject(new DOMException('aborted', 'AbortError'));
    });

    await expect(
      failure(model(client).decide(AGENT_CHECK_CONTEXT, controller.signal)),
    ).resolves.toMatchObject({
      failure: 'timeout',
    });
  });

  it.each([
    ['no text', { candidates: [{ finishReason: 'SAFETY' }] }],
    ['empty text', textResponse('  ')],
    ['text that is not JSON', textResponse('I would retry the stage.', 'MAX_TOKENS')],
  ])('counts %s as invalid output', async (_name, response) => {
    const { client } = stubClient(() => Promise.resolve(response as Response));

    await expect(
      failure(model(client).decide(AGENT_CHECK_CONTEXT, new AbortController().signal)),
    ).resolves.toMatchObject({ failure: 'invalid_output' });
  });

  it('returns JSON that is not a valid decision for the supervisor to refuse', async () => {
    const { client } = stubClient(() => Promise.resolve(textResponse('{"action":"delete_all"}')));
    const raw = await model(client).decide(AGENT_CHECK_CONTEXT, new AbortController().signal);

    expect(parseAgentDecision(raw)).toBeUndefined();
  });
});

describe('GeminiAgentModel through the real SDK', () => {
  it('sends the key as a header, never in the URL, and reads the answer', async () => {
    const calls: { body: unknown; headers: Headers; url: string }[] = [];
    const answer = decision('wait', { minutes: 60 });

    const fetchStub: typeof fetch = (input, init) => {
      calls.push({
        body: JSON.parse(typeof init?.body === 'string' ? init.body : 'null') as unknown,
        headers: new Headers(init?.headers),
        url: input instanceof Request ? input.url : String(input),
      });

      return Promise.resolve(
        Response.json({
          candidates: [
            {
              content: { parts: [{ text: JSON.stringify(answer) }], role: 'model' },
              finishReason: 'STOP',
            },
          ],
        }),
      );
    };

    const gemini = new GeminiAgentModel({
      apiKey: new SecretValue(API_KEY),
      fetch: fetchStub,
      logger,
      model: 'gemini-2.5-flash',
    });

    await expect(gemini.decide(AGENT_CHECK_CONTEXT, new AbortController().signal)).resolves.toEqual(
      answer,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    );
    expect(calls[0]?.url).not.toContain(API_KEY);
    expect(calls[0]?.headers.get('x-goog-api-key')).toBe(API_KEY);
    expect(calls[0]?.body).toMatchObject({
      generationConfig: {
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
        temperature: 0,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
  });

  it('retries nothing itself: a 429 is one failed call', async () => {
    let calls = 0;

    const fetchStub: typeof fetch = () => {
      calls += 1;

      return Promise.resolve(
        Response.json({ error: { code: 429, message: 'quota' } }, { status: 429 }),
      );
    };

    const gemini = new GeminiAgentModel({
      apiKey: new SecretValue(API_KEY),
      fetch: fetchStub,
      logger,
      model: 'gemini-2.5-flash',
    });

    await expect(
      failure(gemini.decide(AGENT_CHECK_CONTEXT, new AbortController().signal)),
    ).resolves.toMatchObject({
      failure: 'rate_limited',
    });
    expect(calls).toBe(1);
    expect(logs.join('\n')).not.toContain(API_KEY);
  });
});

describe('thinkingConfigFor', () => {
  it.each([
    ['gemini-2.5-flash', { thinkingBudget: 0 }],
    ['gemini-2.5-flash-lite', { thinkingBudget: 0 }],
    ['gemini-3.8-flash', { thinkingLevel: 'LOW' }],
    ['gemini-3-pro-preview', { thinkingLevel: 'LOW' }],
    ['gemini-2.0-flash', undefined],
  ])('%s → %j', (name, config) => {
    expect(thinkingConfigFor(name)).toEqual(config);
  });
});

describe('NoopAgentModel', () => {
  it('always hands the incident to you, with a valid decision', async () => {
    const noop = new NoopAgentModel();
    const raw = await noop.decide(AGENT_CHECK_CONTEXT, new AbortController().signal);

    expect(noop.id).toBe('none');
    expect(parseAgentDecision(raw)).toMatchObject({
      action: { action: 'notify_user', summary: NOOP_SUMMARY },
    });
  });
});
