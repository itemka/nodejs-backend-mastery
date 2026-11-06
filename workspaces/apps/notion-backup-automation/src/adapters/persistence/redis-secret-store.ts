import type { SecretName, SecretStore, StoredSecret } from '../../application/ports.js';
import type { AppEnv } from '../../config/env.js';
import type { Clock } from '../../shared/clock.js';
import { systemClock } from '../../shared/clock.js';
import type { EnvelopeKey, EnvelopeMeta } from '../../shared/envelope-crypto.js';
import { EnvelopeError, openEnvelope, sealEnvelope } from '../../shared/envelope-crypto.js';
import { persistenceKeys } from './keys.js';

/** The two string commands the store needs; `@upstash/redis` and test fakes both provide them. */
export interface StringCommands {
  get(key: string): Promise<null | string>;
  set(key: string, value: string): Promise<unknown>;
}

export interface RedisSecretStoreOptions {
  appEnv: AppEnv;
  clock?: Clock;
  key: EnvelopeKey;
  keyPrefix: string;
  redis: StringCommands;
}

/**
 * Secrets as AES-256-GCM envelopes in Redis (`secret:<name>`). The AAD binds each envelope to
 * its environment and name (`nba:<APP_ENV>:<name>:v1`), so a dev secret never opens in prod.
 */
export class RedisSecretStore implements SecretStore {
  private readonly keys;
  private readonly options: Required<RedisSecretStoreOptions>;

  constructor(options: RedisSecretStoreOptions) {
    this.keys = persistenceKeys(options.keyPrefix);
    this.options = { clock: systemClock, ...options };
  }

  /**
   * Undefined when the secret was never stored. Throws `EnvelopeError` when it cannot be opened:
   * a different key (`KEY_MISMATCH`), tampering or another environment (`AUTHENTICATION_FAILED`).
   */
  async get(name: SecretName): Promise<StoredSecret | undefined> {
    const stored = await this.options.redis.get(this.keys.secret(name));

    if (stored === null) {
      return undefined;
    }

    let envelope: unknown;

    try {
      envelope = JSON.parse(stored);
    } catch {
      throw new EnvelopeError('ENVELOPE_INVALID');
    }

    const opened = openEnvelope({ context: this.context(name), envelope, key: this.options.key });

    return { createdAt: opened.createdAt, meta: opened.meta, value: opened.plaintext };
  }

  async put(name: SecretName, value: string, meta: EnvelopeMeta = {}): Promise<void> {
    const envelope = sealEnvelope({
      context: this.context(name),
      createdAt: this.options.clock.now(),
      key: this.options.key,
      meta,
      plaintext: value,
    });

    await this.options.redis.set(this.keys.secret(name), JSON.stringify(envelope));
  }

  private context(name: SecretName): string {
    return `nba:${this.options.appEnv}:${name}:v1`;
  }
}
