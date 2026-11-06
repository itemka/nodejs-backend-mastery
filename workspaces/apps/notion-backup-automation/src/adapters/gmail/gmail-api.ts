import type { GoogleApiClient } from '../google/google-api-client.js';
import type { GmailMessage, GmailProfile } from './gmail-schemas.js';
import {
  gmailMessageIdSchema,
  gmailMessageListSchema,
  gmailMessageSchema,
  gmailProfileSchema,
} from './gmail-schemas.js';

const GMAIL_USER_URL = 'https://gmail.googleapis.com/gmail/v1/users/me';

export interface GmailMessageIdsPage {
  ids: string[];
  nextPageToken: string | undefined;
}

/** The three Gmail REST calls the app makes, all read-only (`gmail.readonly`). */
export class GmailApi {
  constructor(private readonly client: GoogleApiClient) {}

  /**
   * `users.messages.get` with `format=full`: headers and body parts. An aborted `signal` cancels
   * the request and its retries, as for every call here.
   */
  getMessage(messageId: string, signal?: AbortSignal): Promise<GmailMessage> {
    const id = gmailMessageIdSchema.parse(messageId);

    return this.client.json(gmailMessageSchema, {
      query: { format: 'full' },
      signal,
      url: `${GMAIL_USER_URL}/messages/${id}`,
    });
  }

  /** `users.getProfile`. The address is personal data: show it only masked. */
  getProfile(signal?: AbortSignal): Promise<GmailProfile> {
    return this.client.json(gmailProfileSchema, { signal, url: `${GMAIL_USER_URL}/profile` });
  }

  /** One `users.messages.list` page; the caller follows `nextPageToken`. */
  async listMessageIds(
    query: string,
    maxResults: number,
    pageToken?: string,
    signal?: AbortSignal,
  ): Promise<GmailMessageIdsPage> {
    const list = await this.client.json(gmailMessageListSchema, {
      query: { maxResults, pageToken, q: query },
      signal,
      url: `${GMAIL_USER_URL}/messages`,
    });

    return {
      ids: (list.messages ?? []).map((message) => message.id),
      nextPageToken: list.nextPageToken,
    };
  }
}
