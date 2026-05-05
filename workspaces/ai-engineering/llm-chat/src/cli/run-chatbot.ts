import type { ChatOptions, Messages, ToolEvent } from '../chat/types.js';

export type InputFunction = (prompt: string) => Promise<string>;
export type OutputFunction = (text: string) => void;
export type OutputChunkFunction = (text: string) => void;
export type TurnRunner = (
  messages: Messages,
  text: string,
  options: ChatOptions,
) => Promise<string>;

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

    const answer = await options.runTurn(messages, userInput, chatOptions);

    output(didStreamText ? '' : answer);
  }
}
