import type { LlmToolDefinition } from '@workspaces/packages/llm-client';

export type AppToolDefinition = LlmToolDefinition;

export interface Reminder {
  readonly id: string;
  readonly message: string;
  readonly scheduledFor: string;
}

export interface ReminderStore {
  readonly reminders: Reminder[];
}

export interface AppToolExecutionContext {
  readonly now: () => Date;
  readonly reminderStore: ReminderStore;
}

export type AppToolResult = Record<string, unknown>;

export interface AppTool {
  readonly definition: AppToolDefinition;
  readonly execute: (
    input: unknown,
    context: AppToolExecutionContext,
  ) => AppToolResult | Promise<AppToolResult>;
}

export function createReminderStore(): ReminderStore {
  return { reminders: [] };
}

export function createAppToolExecutionContext(): AppToolExecutionContext {
  return {
    now: () => new Date(),
    reminderStore: createReminderStore(),
  };
}
