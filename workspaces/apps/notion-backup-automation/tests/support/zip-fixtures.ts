import { fileURLToPath } from 'node:url';

/** The path of a fixture in `tests/fixtures/zips/`; its README says how each was made. */
export function zipFixture(name: string): string {
  return fileURLToPath(new URL(`../fixtures/zips/${name}`, import.meta.url));
}
