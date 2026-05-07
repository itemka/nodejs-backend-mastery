import type { LlmWebSearchSource } from '@workspaces/packages/llm-client';

import type { ChatOptions, Messages, ToolEvent } from '../chat/types.js';

export type InputFunction = (prompt: string) => Promise<string>;
export type OutputFunction = (text: string) => void;
export type OutputChunkFunction = (text: string) => void;
export type TurnRunner = (
  messages: Messages,
  text: string,
  options: ChatOptions,
) => Promise<string>;

export const MAX_DISPLAYED_SOURCES = 5;
export const MAX_SOURCE_EXCERPT_LENGTH = 180;

export interface RunChatbotOptions {
  readonly debugResponse?: boolean;
  readonly fineGrainedToolStreaming?: boolean;
  readonly input: InputFunction;
  readonly maxTokens?: number;
  readonly output?: OutputFunction;
  readonly outputChunk?: OutputChunkFunction;
  readonly outputFormat?: ChatOptions['outputFormat'];
  readonly runTurn: TurnRunner;
  readonly stream?: boolean;
  readonly toolsEnabled?: boolean;
}

function formatToolEvent(event: ToolEvent): string {
  if (event.type === 'tool_requested') {
    return `[tool] Claude requested ${event.toolName}`;
  }

  if (event.type === 'tool_running') {
    return `[tool] Running ${event.toolName}`;
  }

  if (event.type === 'tool_succeeded') {
    return `[tool] ${event.toolName} succeeded`;
  }

  if (event.type === 'tool_failed') {
    return `[tool] ${event.toolName} failed`;
  }

  if (event.type === 'tool_results_submitted') {
    return event.count === 1
      ? '[tool] Sending tool result to Claude'
      : '[tool] Sending tool results to Claude';
  }

  if (event.type === 'tool_input_stream_started') {
    return `[tool] Streaming input for ${event.toolName}`;
  }

  if (event.type === 'tool_input_stream_completed') {
    return '[tool] Tool input completed';
  }

  if (event.type === 'tool_input_stream_failed') {
    return '[tool] Tool input streaming failed';
  }

  return '[tool] Final response received';
}

function dedupeSources(sources: readonly LlmWebSearchSource[]): LlmWebSearchSource[] {
  const seen = new Set<string>();
  const unique: LlmWebSearchSource[] = [];

  for (const source of sources) {
    if (seen.has(source.url)) {
      continue;
    }

    seen.add(source.url);
    unique.push(source);
  }

  return unique;
}

function hostnameForUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function formatSourceExcerpt(text: string): string | undefined {
  const normalized = text.replaceAll(/\s+/g, ' ').trim();

  if (normalized === '') {
    return undefined;
  }

  if (normalized.length <= MAX_SOURCE_EXCERPT_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_SOURCE_EXCERPT_LENGTH - 3)}...`;
}

export function renderSources(sources: readonly LlmWebSearchSource[]): string[] {
  const unique = dedupeSources(sources);

  if (unique.length === 0) {
    return [];
  }

  const displayed = unique.slice(0, MAX_DISPLAYED_SOURCES);
  const lines: string[] = ['', 'Sources:'];

  for (const [index, source] of displayed.entries()) {
    const titleOrHost = source.title ?? hostnameForUrl(source.url);
    lines.push(`  ${index + 1}. ${titleOrHost} — ${source.url}`);

    const excerpt = formatSourceExcerpt(source.citedText);

    if (excerpt !== undefined) {
      lines.push(`     "${excerpt}"`);
    }
  }

  return lines;
}

export async function runChatbot(options: RunChatbotOptions): Promise<Messages> {
  const messages: Messages = [];
  const output = options.output ?? console.log;
  const outputChunk = options.outputChunk ?? ((text) => process.stdout.write(text));

  while (true) {
    let userInput: string;

    try {
      userInput = await options.input('> ');
    } catch {
      output('');

      return messages;
    }

    const chatOptions: ChatOptions = {};
    let didStreamText = false;
    const collectedSources: LlmWebSearchSource[] = [];

    if (options.maxTokens !== undefined) {
      chatOptions.maxTokens = options.maxTokens;
    }

    if (options.debugResponse !== undefined) {
      chatOptions.debugResponse = options.debugResponse;
    }

    const fineGrainedToolStreaming =
      options.toolsEnabled === true && options.fineGrainedToolStreaming === true;
    chatOptions.stream =
      options.toolsEnabled === true ? fineGrainedToolStreaming : (options.stream ?? true);

    if (options.outputFormat) {
      chatOptions.outputFormat = options.outputFormat;
    }

    if (options.toolsEnabled === true) {
      chatOptions.toolsEnabled = true;

      if (fineGrainedToolStreaming) {
        chatOptions.fineGrainedToolStreaming = true;
      }

      chatOptions.onToolEvent = (event) => {
        output(formatToolEvent(event));
      };
    } else {
      chatOptions.onTextDelta = (text) => {
        didStreamText = true;

        outputChunk(text);
      };
    }

    chatOptions.onSources = (sources) => {
      collectedSources.push(...sources);
    };

    const answer = await options.runTurn(messages, userInput, chatOptions);

    output(didStreamText ? '' : answer);

    for (const line of renderSources(collectedSources)) {
      output(line);
    }
  }
}
