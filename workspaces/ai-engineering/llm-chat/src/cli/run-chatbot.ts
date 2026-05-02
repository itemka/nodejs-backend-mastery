import type { ChatOptions, Messages } from '../chat/types.js';

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
  readonly input: InputFunction;
  readonly maxTokens?: number;
  readonly output?: OutputFunction;
  readonly outputChunk?: OutputChunkFunction;
  readonly outputFormat?: ChatOptions['outputFormat'];
  readonly runTurn: TurnRunner;
  readonly stream?: boolean;
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

    chatOptions.stream = options.stream ?? true;

    if (options.outputFormat) {
      chatOptions.outputFormat = options.outputFormat;
    }

    chatOptions.onTextDelta = (text) => {
      didStreamText = true;

      outputChunk(text);
    };

    const answer = await options.runTurn(messages, userInput, chatOptions);

    output(didStreamText ? '' : answer);
  }
}
