import { Receiver } from '@upstash/qstash';

/** A delivery to check: the `Upstash-Signature` header, the raw body, and the URL it was sent to. */
export interface SignedDelivery {
  readonly body: string;
  readonly signature: string;
  readonly url: string;
}

/** Whether a delivery is genuine. A forged, expired, tampered or misdirected one is false. */
export interface SignatureVerifier {
  verify(delivery: SignedDelivery): Promise<boolean>;
}

export interface SigningKeys {
  readonly current: string;
  readonly next: string;
}

/**
 * QStash's `Receiver`: an HS256 JWT signed with the current key, or the next one while keys
 * rotate, whose `sub` is the URL and whose `body` claim is the SHA-256 of the raw body; `exp`
 * and `nbf` are enforced. `devMode: false`, or a stray `QSTASH_DEV` would swap in QStash's
 * public local-dev keys (S3).
 */
export class QStashSignatureVerifier implements SignatureVerifier {
  private readonly receiver: Receiver;

  constructor(keys: SigningKeys) {
    this.receiver = new Receiver({
      currentSigningKey: keys.current,
      devMode: false,
      nextSigningKey: keys.next,
    });
  }

  async verify({ body, signature, url }: SignedDelivery): Promise<boolean> {
    if (signature === '') {
      return false;
    }

    try {
      return await this.receiver.verify({ body, signature, url });
    } catch {
      // A `SignatureError`, or a token without the claims QStash signs: not genuine either way.
      return false;
    }
  }
}
