import type { IntegrationUpdate } from '@workspaces/telegram-contracts';
import { integrationUpdateSchema } from '@workspaces/telegram-contracts';

export type { CallbackInput, MessageInput } from '@workspaces/telegram-contracts';

export type ParsedUpdate =
  | ({ readonly outcome: 'accepted' } & IntegrationUpdate)
  | { readonly outcome: 'invalid' };

/** The hub authenticated Telegram and removed platform-only fields before forwarding. */
export function parseUpdate(body: unknown): ParsedUpdate {
  const parsed = integrationUpdateSchema.safeParse(body);

  return parsed.success ? { ...parsed.data, outcome: 'accepted' } : { outcome: 'invalid' };
}
