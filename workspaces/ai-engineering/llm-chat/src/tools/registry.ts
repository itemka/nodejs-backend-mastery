import { addDurationToDatetimeTool } from './implementations/add-duration-to-datetime.js';
import { getCurrentDatetimeTool } from './implementations/get-current-datetime.js';
import { searchDocsTool } from './implementations/search-docs.js';
import { setReminderTool } from './implementations/set-reminder.js';
import type { AppTool } from './types.js';

export const llmChatTools = [
  getCurrentDatetimeTool,
  addDurationToDatetimeTool,
  setReminderTool,
] as const satisfies readonly AppTool[];

export interface BuildToolsOptions {
  readonly ragSearchEnabled?: boolean;
}

export function buildLlmChatTools(options: BuildToolsOptions = {}): readonly AppTool[] {
  if (options.ragSearchEnabled === true) {
    return [...llmChatTools, searchDocsTool];
  }

  return llmChatTools;
}

export function findToolByName(tools: readonly AppTool[], name: string): AppTool | undefined {
  return tools.find((tool) => tool.definition.name === name);
}
