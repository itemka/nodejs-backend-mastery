import { isBearer } from './cron-auth.js';

/** Independent integration credential; the Telegram webhook secret is never shared here. */
export function isTelegramRequest(request: Request, integrationToken: string): boolean {
  return isBearer(request.headers.get('authorization'), integrationToken);
}
