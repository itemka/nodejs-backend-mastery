import { addDurationToDatetimeTool } from './implementations/add-duration-to-datetime.js';
import { getCurrentDatetimeTool } from './implementations/get-current-datetime.js';
import { setReminderTool } from './implementations/set-reminder.js';
import type { AppTool } from './types.js';

export const llmChatTools = [
  getCurrentDatetimeTool,
  addDurationToDatetimeTool,
  setReminderTool,
] as const satisfies readonly AppTool[];

export function findToolByName(tools: readonly AppTool[], name: string): AppTool | undefined {
  return tools.find((tool) => tool.definition.name === name);
}
