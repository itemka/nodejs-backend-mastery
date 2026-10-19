import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

/** The checksums Drive reports for a file, and its size. */
export interface Digests {
  readonly md5: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

/** SHA-256 and MD5 of the same bytes, in one pass. */
export class Digester {
  readonly #md5 = createHash('md5');
  readonly #sha256 = createHash('sha256');
  #sizeBytes = 0;

  digest(): Digests {
    return {
      md5: this.#md5.digest('hex'),
      sha256: this.#sha256.digest('hex'),
      sizeBytes: this.#sizeBytes,
    };
  }

  update(bytes: Uint8Array): void {
    this.#md5.update(bytes);
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
