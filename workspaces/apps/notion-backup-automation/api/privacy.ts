import { privacyPage } from '../src/http/public-pages.js';

export function GET(): Response {
  return privacyPage();
}
