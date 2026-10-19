import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

/** The SHA-256 of some bytes, which Drive's `sha256Checksum` must match, and their size. */
export interface Digests {
  readonly sha256: string;
  readonly sizeBytes: number;
}

/** Hashes bytes as they arrive. */
export class Digester {
  readonly #sha256 = createHash('sha256');
  #sizeBytes = 0;

  digest(): Digests {
    return { sha256: this.#sha256.digest('hex'), sizeBytes: this.#sizeBytes };
  }

  update(bytes: Uint8Array): void {
    this.#sha256.update(bytes);
    this.#sizeBytes += bytes.length;
  }
}

export function digestsOf(bytes: Uint8Array): Digests {
  const digester = new Digester();

  digester.update(bytes);

  return digester.digest();
}

export async function digestFile(path: string): Promise<Digests> {
  const digester = new Digester();

  for await (const chunk of createReadStream(path)) {
    digester.update(chunk as Buffer);
  }

  return digester.digest();
}
