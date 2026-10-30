import { z } from 'zod';

export const MAX_CALLBACK_DATA_BYTES = 64;
export const MAX_MESSAGE_LENGTH = 4096;

export const callbackDataSchema = z
  .string()
  .min(1)
  .refine(
    (value) => Buffer.byteLength(value, 'utf8') <= MAX_CALLBACK_DATA_BYTES,
    'Callback data exceeds 64 bytes',
  );

export const telegramButtonSchema = z.union([
  z.strictObject({ callbackData: callbackDataSchema, text: z.string().min(1).max(100) }),
  z.strictObject({
    text: z.string().min(1).max(100),
    url: z.url().refine((value) => new URL(value).protocol === 'https:', 'HTTPS required'),
  }),
]);

export const telegramMessageSchema = z.strictObject({
  buttons: z.array(z.array(telegramButtonSchema).max(8)).max(20).optional(),
  html: z.string().min(1).max(MAX_MESSAGE_LENGTH),
});

export const callbackInputSchema = z.strictObject({
  callbackId: z.string().min(1).max(100),
  data: callbackDataSchema,
  kind: z.literal('callback'),
  messageId: z.number().int().positive().optional(),
});

export const messageInputSchema = z.strictObject({
  kind: z.literal('message'),
  text: z.string().max(MAX_MESSAGE_LENGTH),
});

export const integrationUpdateSchema = z.strictObject({
  input: z.discriminatedUnion('kind', [callbackInputSchema, messageInputSchema]),
  updateId: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});

/** Chat destinations and Telegram method names are controlled by the hub. */
export const hubOperationSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('sendMessage'), message: telegramMessageSchema }),
  z.strictObject({ action: z.literal('removeButtons'), messageId: z.number().int().positive() }),
  z.strictObject({
    action: z.literal('answerCallbackQuery'),
    callbackId: z.string().min(1).max(100),
    text: z.string().max(200).optional(),
  }),
]);

/**
 * Whether a status refuses a request for good: any 4xx except 408 (timeout) and 429 (rate
 * limit). A resend gets the same answer, so the hub and its integrations finish the update
 * instead of retrying it.
 */
export function isPermanentRefusal(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

export type TelegramButton = z.infer<typeof telegramButtonSchema>;
export interface TelegramMessage {
  readonly buttons?: readonly (readonly TelegramButton[])[];
  readonly html: string;
}
export type CallbackInput = z.infer<typeof callbackInputSchema>;
export type MessageInput = z.infer<typeof messageInputSchema>;
export type IntegrationUpdate = z.infer<typeof integrationUpdateSchema>;
export type HubOperation = z.infer<typeof hubOperationSchema>;
