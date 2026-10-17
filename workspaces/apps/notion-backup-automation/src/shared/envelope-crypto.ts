import type { KeyObject } from 'node:crypto';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createSecretKey,
  randomBytes,
} from 'node:crypto';
import { z } from 'zod';

const IV_BYTES = 12;
const TAG_BYTES = 16;
const ALGORITHM = 'aes-256-gcm';

/** Exactly 32 bytes in standard base64: 43 characters and one `=`, as `openssl rand -base64 32` prints. */
const encryptionKeyPattern = /^[A-Za-z0-9+/]{43}=$/;

export type EnvelopeErrorCode =
  | 'AUTHENTICATION_FAILED'
  | 'ENVELOPE_INVALID'
  | 'KEY_INVALID'
  | 'KEY_MISMATCH';

const errorMessages: Record<EnvelopeErrorCode, string> = {
  AUTHENTICATION_FAILED:
    'The envelope failed authentication: wrong context, or a modified field or ciphertext',
  ENVELOPE_INVALID: 'The stored value is not a valid envelope',
  KEY_INVALID: 'The encryption key must be 32 bytes in standard base64',
  KEY_MISMATCH: 'The envelope was sealed with a different encryption key',
};

/** Never carries key material, plaintext or ciphertext. */
export class EnvelopeError extends Error {
  readonly code: EnvelopeErrorCode;

  constructor(code: EnvelopeErrorCode) {
    super(errorMessages[code]);
    this.name = 'EnvelopeError';
    this.code = code;
  }
}

/** A decoded `APP_ENCRYPTION_KEY`. `KeyObject` keeps the bytes out of logs and `JSON.stringify`. */
export interface EnvelopeKey {
  /** The first 8 hex characters of the key's SHA-256. */
  readonly kid: string;
  readonly key: KeyObject;
}

export function isEncryptionKey(base64: string): boolean {
  return encryptionKeyPattern.test(base64);
}

export function createEnvelopeKey(base64: string): EnvelopeKey {
  if (!isEncryptionKey(base64)) {
    throw new EnvelopeError('KEY_INVALID');
  }

  const bytes = Buffer.from(base64, 'base64');

  try {
    return {
      key: createSecretKey(bytes),
      kid: createHash('sha256').update(bytes).digest('hex').slice(0, 8),
    };
  } finally {
    bytes.fill(0);
  }
}

const base64UrlBytes = (length?: number) =>
  z
    .base64url()
    .refine((value) => length === undefined || Buffer.from(value, 'base64url').length === length);

/** Non-secret, size-bounded facts stored next to the ciphertext. They are authenticated, not encrypted. */
export const envelopeMetaSchema = z.record(
  z.string().max(64),
  z.union([z.string().max(512), z.number(), z.boolean()]),
);

export type EnvelopeMeta = z.infer<typeof envelopeMetaSchema>;

export const envelopeSchema = z.object({
  alg: z.literal('A256GCM'),
  createdAt: z.iso.datetime(),
  ct: base64UrlBytes(),
  iv: base64UrlBytes(IV_BYTES),
  kid: z.string().regex(/^[0-9a-f]{8}$/),
  meta: envelopeMetaSchema,
  tag: base64UrlBytes(TAG_BYTES),
  v: z.literal(1),
});

export type Envelope = z.infer<typeof envelopeSchema>;

export interface SealInput {
  /** Binds the ciphertext to its purpose, for example `nba:prod:notion-storage-state:v1`. */
  context: string;
  createdAt: Date;
  key: EnvelopeKey;
  meta?: EnvelopeMeta;
  plaintext: string;
}

export interface OpenInput {
  context: string;
  envelope: unknown;
  key: EnvelopeKey;
}

export interface OpenedEnvelope {
  createdAt: string;
  meta: EnvelopeMeta;
  plaintext: string;
}

/** AES-256-GCM with a random 12-byte IV per call. */
export function sealEnvelope(input: SealInput): Envelope {
  const header = {
    alg: 'A256GCM',
    createdAt: input.createdAt.toISOString(),
    kid: input.key.kid,
    meta: input.meta ?? {},
    v: 1,
  } as const;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, input.key.key, iv, { authTagLength: TAG_BYTES });

  cipher.setAAD(additionalData(input.context, header));

  const ct = Buffer.concat([cipher.update(input.plaintext, 'utf8'), cipher.final()]);

  return {
    ...header,
    ct: ct.toString('base64url'),
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
  };
}

export function openEnvelope(input: OpenInput): OpenedEnvelope {
  const parsed = envelopeSchema.safeParse(input.envelope);

  if (!parsed.success) {
    throw new EnvelopeError('ENVELOPE_INVALID');
  }

  const envelope = parsed.data;

  if (envelope.kid !== input.key.kid) {
    throw new EnvelopeError('KEY_MISMATCH');
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    input.key.key,
    Buffer.from(envelope.iv, 'base64url'),
    { authTagLength: TAG_BYTES },
  );

  decipher.setAAD(additionalData(input.context, envelope));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));

  try {
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ct, 'base64url')),
      decipher.final(),
    ]).toString('utf8');

    return { createdAt: envelope.createdAt, meta: envelope.meta, plaintext };
  } catch {
    throw new EnvelopeError('AUTHENTICATION_FAILED');
  }
}

/**
 * The context plus every header field, with `meta` keys sorted by UTF-16 code unit, so the
 * bytes are the same on every machine. Object keys are unique, so no two compare equal.
 */
function additionalData(
  context: string,
  header: Pick<Envelope, 'alg' | 'createdAt' | 'kid' | 'meta' | 'v'>,
): Buffer {
  const meta = Object.entries(header.meta).toSorted(([a], [b]) => (a < b ? -1 : 1));
  const fields = [header.v, header.alg, header.kid, header.createdAt, meta];

  return Buffer.from(`${context}\n${JSON.stringify(fields)}`, 'utf8');
}
