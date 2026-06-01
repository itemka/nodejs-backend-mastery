import * as ui from '@workspaces/cli-output';

import type { ChatSession } from '../chat/chat-session.js';
import {
  buildUserTextWithContext,
  listKnownDocumentIds,
  resolveMentions,
} from '../chat/document-context.js';
import { mcpPromptToChatMessages } from '../chat/prompt-converter.js';
import type { ChatOptions, ToolEvent } from '../chat/types.js';
import type { McpStdioClient } from '../client/mcp-client.js';

export type InputFunction = (prompt: string) => Promise<string>;
export type OutputFunction = (text: string) => void;
export type OutputChunkFunction = (text: string) => void;

export interface RunChatbotOptions {
  readonly documentServer: McpStdioClient;
  readonly input: InputFunction;
  readonly maxTokens?: number;
  readonly output?: OutputFunction;
  readonly outputChunk?: OutputChunkFunction;
  readonly session: ChatSession;
  readonly stream?: boolean;
}

function formatToolEvent(event: ToolEvent): string | undefined {
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

  return undefined;
}

async function listAvailableCommands(client: McpStdioClient): Promise<readonly string[]> {
  const prompts = await client.listPrompts();

  return prompts.map((prompt) => prompt.name);
}

function parseSlashCommand(input: string): { args: string[]; name: string } | undefined {
  const trimmed = input.trim();

  if (!trimmed.startsWith('/')) {
    return undefined;
  }

  const tokens = trimmed.slice(1).split(/\s+/).filter(Boolean);

  if (tokens.length === 0) {
    return undefined;
  }

  return { args: tokens.slice(1), name: tokens[0]! };
}

function buildPromptArgsRecord(
  promptName: string,
  args: readonly string[],
  declared: readonly { name: string; required?: boolean | undefined }[] | undefined,
): Record<string, string> {
  if (declared === undefined || declared.length === 0) {
    return {};
  }

  const out: Record<string, string> = {};

  for (const [index, declaration] of declared.entries()) {
    const value = args[index];

    if (value !== undefined) {
      out[declaration.name] = value;
      continue;
    }

    if (declaration.required === true) {
      throw new Error(
        `/${promptName} requires argument "${declaration.name}" (position ${String(index + 1)}).`,
      );
    }
  }

  return out;
}

export async function runChatbot(options: RunChatbotOptions): Promise<void> {
  // Color is applied where each line's role is known (tool events, status and
  // error lines below) rather than by sniffing arbitrary output — so an
  // assistant answer is never recolored. `formatToolEvent` stays uncolored and
  // testable. Tests capture plain strings because chalk is disabled under
  // Vitest; color degrades automatically via chalk's NO_COLOR/TTY detection.
  const output = options.output ?? console.log;
  const outputChunk = options.outputChunk ?? ((text) => process.stdout.write(text));
  const stream = options.stream ?? true;

  while (true) {
    let userInput: string;

    try {
      userInput = await options.input('> ');
    } catch {
      output('');

      return;
    }

    const trimmed = userInput.trim();

    if (trimmed === '') {
      continue;
    }

    if (trimmed === 'exit' || trimmed === 'quit') {
      return;
    }

    if (trimmed === '/') {
      const commands = await listAvailableCommands(options.documentServer);
      output(
        commands.length === 0
          ? ui.muted('(no MCP commands available)')
          : ui.heading(`Commands: /${commands.join(', /')}`),
      );
      continue;
    }

    if (trimmed === '@') {
      const docs = await listKnownDocumentIds(options.documentServer);
      output(
        docs.length === 0
          ? ui.muted('(no documents available)')
          : ui.heading(`Documents: @${docs.join(', @')}`),
      );
      continue;
    }

    const parsedCommand = parseSlashCommand(trimmed);
    let streamedTextNeedsLineBreak = false;

    const outputLine = (line: string): void => {
      if (streamedTextNeedsLineBreak) {
        output('');
        streamedTextNeedsLineBreak = false;
      }

      output(line);
    };

    const chatOptions: ChatOptions = {
      stream,
      ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
      onToolEvent: (event) => {
        const line = formatToolEvent(event);

        if (line !== undefined) {
          outputLine(ui.accent(line));
        }
      },
    };
    let didStreamText = false;

    chatOptions.onTextDelta = (text) => {
      didStreamText = true;
      streamedTextNeedsLineBreak = text.length > 0 && !text.endsWith('\n');
      outputChunk(text);
    };

    let messageText: string;

    if (parsedCommand === undefined) {
      const mentions = await resolveMentions(options.documentServer, userInput);

      for (const docId of mentions.unknown) {
        output(ui.warn(`[context] Unknown document: @${docId}`));
      }

      messageText = buildUserTextWithContext(userInput, mentions.snippets);
    } else {
      const prompts = await options.documentServer.listPrompts();
      const promptMeta = prompts.find((p) => p.name === parsedCommand.name);

      if (promptMeta === undefined) {
        output(ui.warn(`Unknown command: /${parsedCommand.name}`));
        continue;
      }

      let promptArgs: Record<string, string>;

      try {
        promptArgs = buildPromptArgsRecord(
          parsedCommand.name,
          parsedCommand.args,
          promptMeta.arguments,
        );
      } catch (error) {
        output(ui.error(error instanceof Error ? error.message : String(error)));
        continue;
      }

      const promptResult = await options.documentServer.getPrompt(parsedCommand.name, promptArgs);
      const promptMessages = mcpPromptToChatMessages(promptResult);

      if (promptMessages.length === 0) {
        output(ui.muted('(prompt returned no text messages)'));
        continue;
      }

      const head = promptMessages.slice(0, -1);
      const lastMessage = promptMessages.at(-1);

      if (lastMessage?.role !== 'user') {
        options.session.appendMessages(promptMessages);
        const answer = await options.session.sendUserMessage(
          '(continue with the instructions above)',
          chatOptions,
        );
        output(didStreamText ? '' : answer);
        continue;
      }

      options.session.appendMessages(head);

      if (typeof lastMessage.content === 'string') {
        messageText = lastMessage.content;
      } else {
        output(ui.muted('(prompt last message had non-text content; skipping turn)'));
        continue;
      }
    }

    const answer = await options.session.sendUserMessage(messageText, chatOptions);
    output(didStreamText ? '' : answer);
  }
}
