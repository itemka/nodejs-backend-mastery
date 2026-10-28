import type { DeliveryState } from '../ports.js';

export interface RedisCommands {
  eval(script: string, keys: string[], args: (number | string)[]): Promise<unknown>;
}

const CLAIM = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 'done' end
if redis.call('SET', KEYS[2], ARGV[1], 'NX', 'EX', 60) then return 'claimed' end
return 'busy'`;
const COMPLETE = `
if redis.call('GET', KEYS[2]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], '1', 'EX', 172800)
redis.call('DEL', KEYS[2])
return 1`;
const RELEASE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0`;
const ALLOW = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 1 end
local count = tonumber(redis.call('GET', KEYS[2]) or '0')
if count >= 30 then return 0 end
redis.call('INCR', KEYS[2])
redis.call('EXPIRE', KEYS[2], ARGV[1])
redis.call('SET', KEYS[1], '1', 'EX', 172800)
return 1`;

/** Own prefix/database; never reads the integration's backup/job state. */
export class RedisDeliveryState implements DeliveryState {
  constructor(
    private readonly redis: RedisCommands,
    private readonly prefix: string,
    private readonly now = Date.now,
  ) {}

  async claim(updateId: number, token: string): Promise<'busy' | 'claimed' | 'done'> {
    const result = await this.redis.eval(CLAIM, this.keys(updateId), [token]);

    if (result !== 'busy' && result !== 'claimed' && result !== 'done') {
      throw new Error('Invalid delivery claim result');
    }

    return result;
  }

  async complete(updateId: number, token: string): Promise<void> {
    if ((await this.redis.eval(COMPLETE, this.keys(updateId), [token])) !== 1) {
      throw new Error('Delivery lease expired');
    }
  }

  async release(updateId: number, token: string): Promise<void> {
    await this.redis.eval(RELEASE, [this.keys(updateId)[1]], [token]);
  }

  async allow(updateId: number): Promise<boolean> {
    const window = Math.floor(this.now() / 3_600_000);
    const ttl = Math.max(1, Math.ceil(((window + 1) * 3_600_000 - this.now()) / 1000));

    return (
      (await this.redis.eval(
        ALLOW,
        [`${this.prefix}:allowed:${updateId}`, `${this.prefix}:rate:${window}`],
        [ttl],
      )) === 1
    );
  }

  private keys(updateId: number): [string, string] {
    return [`${this.prefix}:done:${updateId}`, `${this.prefix}:processing:${updateId}`];
  }
}
