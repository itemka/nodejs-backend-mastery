import type {
  AttentionNotification,
  FailureNotification,
  LoginWarningNotification,
  Notifier,
  SuccessNotification,
} from '../../application/ports.js';
import type { MessageFormatOptions } from '../telegram/message-formats.js';
import {
  attentionMessage,
  failureMessage,
  loginWarningMessage,
  successMessage,
} from '../telegram/message-formats.js';
import type { TelegramClient, TelegramMessage } from '../telegram/telegram-client.js';

export interface TelegramNotifierOptions extends MessageFormatOptions {
  readonly client: Pick<TelegramClient, 'sendMessage'>;
}

/** Sends each notification to your chat. A failed send throws `TelegramApiError`. */
export class TelegramNotifier implements Notifier {
  private readonly client: Pick<TelegramClient, 'sendMessage'>;
  private readonly format: MessageFormatOptions;

  constructor({ appEnv, client, timeZone }: TelegramNotifierOptions) {
    this.client = client;
    this.format = { appEnv, timeZone };
  }

  attention(notification: AttentionNotification): Promise<void> {
    return this.send(attentionMessage(notification, this.format));
  }

  failure(notification: FailureNotification): Promise<void> {
    return this.send(failureMessage(notification, this.format));
  }

  loginWarning(notification: LoginWarningNotification): Promise<void> {
    return this.send(loginWarningMessage(notification, this.format));
  }

  success(notification: SuccessNotification): Promise<void> {
    return this.send(successMessage(notification, this.format));
  }

  private async send(message: TelegramMessage): Promise<void> {
    await this.client.sendMessage(message);
  }
}
