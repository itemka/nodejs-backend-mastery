import { homePage } from '../src/http/public-pages.js';

export function GET(): Response {
  return homePage();
}
