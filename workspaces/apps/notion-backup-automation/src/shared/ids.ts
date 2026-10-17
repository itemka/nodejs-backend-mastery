import { randomBytes } from 'node:crypto';

/** Random identifiers. Tests replace it with a deterministic generator. */
export interface IdGenerator {
  /** 128 random bits, base64url (22 characters). Used for QStash schedule tokens. */
  token(): string;
  /** 64 random bits, hex (16 characters). Used for worker IDs in leases and tick IDs in logs. */
  shortId(): string;
}

export const randomIds: IdGenerator = {
  shortId: () => randomBytes(8).toString('hex'),
  token: () => randomBytes(16).toString('base64url'),
};
