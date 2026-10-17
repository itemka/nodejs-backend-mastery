import { Redis } from '@upstash/redis';

export interface RedisConnection {
  token: string;
  url: string;
}

/**
 * The Upstash REST client. Responses stay raw strings: automatic JSON deserialization would turn
 * stored JSON and Lua replies into objects and numbers behind the schema's back.
 */
export function createRedisClient({ token, url }: RedisConnection): Redis {
  return new Redis({ automaticDeserialization: false, enableTelemetry: false, token, url });
}
