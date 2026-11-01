import { termsPage } from '../src/http/public-pages.js';

export function GET(): Response {
  return termsPage();
}
