import type { GoogleApiClient } from '../google/google-api-client.js';
import type { GmailMessage, GmailProfile } from './gmail-schemas.js';
import {
  gmailMessageIdSchema,
  gmailMessageListSchema,
  gmailMessageSchema,
  gmailProfileSchema,
} from './gmail-schemas.js';

const GMAIL_USER_URL = 'https://gmail.googleapis.com/gmail/v1/users/me';

/** The three Gmail REST calls the app makes, all read-only (`gmail.readonly`). */
export class GmailApi {
  private readonly client: GoogleApiClient;

  constructor(client: GoogleApiClient) {
    this.client = client;
  }

  /** `users.messages.get` with `format=full`: headers and body parts. */
  getMessage(messageId: string): Promise<GmailMessage> {
    const id = gmailMessageIdSchema.parse(messageId);

    return this.client.json(gmailMessageSchema, {
      query: { format: 'full' },
      url: `${GMAIL_USER_URL}/messages/${id}`,
    });
  }

  /** `users.getProfile`. The address is personal data: show it only masked. */
  getProfile(): Promise<GmailProfile> {
    return this.client.json(gmailProfileSchema, { url: `${GMAIL_USER_URL}/profile` });
  }

  /** `users.messages.list`: the IDs of up to `maxResults` messages matching a search query. */
  async listMessageIds(query: string, maxResults: number): Promise<string[]> {
    const list = await this.client.json(gmailMessageListSchema, {
      query: { maxResults, q: query },
      url: `${GMAIL_USER_URL}/messages`,
    });

    return (list.messages ?? []).map((message) => message.id);
  }
}
