import { z } from 'zod';

const timestamp = z.iso.datetime();

/**
 * The last result of each health probe (`health` in Redis), as `backup_health` shows it.
 * Probes overwrite their own field; nothing here is secret.
 */
export const healthSnapshotSchema = z.object({
  agentCheck: z
    .object({ checkedAt: timestamp, model: z.string().max(100), ok: z.boolean() })
    .optional(),
  cron: z.object({ ranAt: timestamp }).optional(),
  driveRoot: z
    .object({ checkedAt: timestamp, mode: z.enum(['existing', 'app-owned']), ok: z.boolean() })
    .optional(),
  google: z
    .object({
      checkedAt: timestamp,
      scopes: z.array(z.string().max(100)).max(10),
      tokenOk: z.boolean(),
    })
    .optional(),
  /** The last login warning sent; these belong to no job, so they are recorded here. */
  loginWarning: z
    .object({
      kind: z.enum(['expiring', 'lost', 'renewed']),
      sentAt: timestamp,
      service: z.enum(['google', 'notion']),
    })
    .optional(),
  notionSession: z
    .object({
      authCookieExpiresAt: timestamp.optional(),
      checkedAt: timestamp,
      state: z.enum(['valid', 'expired', 'challenge', 'missing', 'error']),
    })
    .optional(),
  /** The nonce of the last signed `_ping` delivery: the deployed QStash smoke test. */
  qstashPing: z
    .object({ nonce: z.string().regex(/^[\w-]{8,64}$/), receivedAt: timestamp })
    .optional(),
});

export type HealthSnapshot = z.infer<typeof healthSnapshotSchema>;

export type HealthField = keyof HealthSnapshot;

export const healthFields = Object.keys(healthSnapshotSchema.shape) as HealthField[];
