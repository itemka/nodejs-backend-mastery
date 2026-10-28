import type { TelegramMessage } from '@workspaces/telegram-contracts';

export interface BotClient {
  answerCallbackQuery(callbackId: string, text?: string): Promise<void>;
  removeButtons(chatId: string, messageId: number): Promise<void>;
  sendMessage(chatId: string, message: TelegramMessage): Promise<{ messageId: number }>;
}

export interface DeliveryState {
  claim(updateId: number, token: string): Promise<'busy' | 'claimed' | 'done'>;
  complete(updateId: number, token: string): Promise<void>;
  release(updateId: number, token: string): Promise<void>;
  /** A retry of this same update consumes no second quota unit. */
  allow(updateId: number): Promise<boolean>;
}
