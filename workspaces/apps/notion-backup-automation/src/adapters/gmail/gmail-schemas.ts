import { z } from 'zod';

/** Gmail message IDs are hex; the job schema accepts the same characters. */
export const gmailMessageIdSchema = z.string().regex(/^[\w-]{1,128}$/);

export const gmailProfileSchema = z.object({
  emailAddress: z.string(),
});

export type GmailProfile = z.infer<typeof gmailProfileSchema>;

export const gmailMessageListSchema = z.object({
  messages: z.array(z.object({ id: gmailMessageIdSchema })).optional(),
});

const gmailHeaderSchema = z.object({ name: z.string(), value: z.string() });

export type GmailHeader = z.infer<typeof gmailHeaderSchema>;

/** One MIME part of `format=full`. `body.data` is base64url of the decoded content. */
export interface GmailMessagePart {
  body?: { data?: string | undefined } | undefined;
  headers?: GmailHeader[] | undefined;
  mimeType?: string | undefined;
  parts?: GmailMessagePart[] | undefined;
}

export const gmailMessagePartSchema: z.ZodType<GmailMessagePart> = z.object({
  body: z.object({ data: z.string().optional() }).optional(),
  headers: z.array(gmailHeaderSchema).optional(),
  mimeType: z.string().optional(),
  get parts() {
    return z.array(gmailMessagePartSchema).optional();
  },
});

/** `users.messages.get` with `format=full`. Headers are in message order, top first. */
export const gmailMessageSchema = z.object({
  id: gmailMessageIdSchema,
  /** Milliseconds since the epoch, as a string: when Gmail received the message. */
  internalDate: z.string().regex(/^\d{1,16}$/),
  payload: gmailMessagePartSchema,
});

export type GmailMessage = z.infer<typeof gmailMessageSchema>;
