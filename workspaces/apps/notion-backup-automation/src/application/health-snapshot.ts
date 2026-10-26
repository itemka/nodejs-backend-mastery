import { z } from 'zod';

import { errorCodeSchema } from '../domain/error-catalog.js';

const timestamp = z.iso.datetime();

/** A failed probe's cataloged error code. */
const probeCode = errorCodeSchema.optional();

/**
 * The last result of each health probe (`health` in Redis), as `backup_health` shows it.
 * Probes overwrite their own field; nothing here is secret.
 */
export const healthSnapshotSchema = z.object({
  agentCheck: z
    .object({ checkedAt: timestamp, model: z.string().max(100), ok: z.boolean() })
    .optional(),
  /** The daily cron's last run; `ok` once it finished, false when a sub-step threw. */
  cron: z.object({ ok: z.boolean().optional(), ranAt: timestamp }).optional(),
  /** `mode` is unknown when the root could not be read. */
  driveRoot: z
    .object({
      checkedAt: timestamp,
      code: probeCode,
      mode: z.enum(['existing', 'app-owned']).optional(),
      ok: z.boolean(),
    })
    .optional(),
  google: z
    .object({
      checkedAt: timestamp,
      code: probeCode,
      scopes: z.array(z.string().max(100)).max(10),
      tokenOk: z.boolean(),
    })
    .optional(),
  /** The last login warning sent; these belong to no job, so they are recorded here. */
  loginWarning: z
    .object({
      kind: z.enum(['expiring', 'lost', 'renewed']),
      sentAt: timestamp,
      service: z.enum(['drive', 'google', 'notion']),
    })
    .optional(),
  /** `exportDialog` once the probe got past the session gate. */
  notionSession: z
    .object({
      authCookieExpiresAt: timestamp.optional(),
      checkedAt: timestamp,
      code: probeCode,
      exportDialog: z.enum(['ready', 'in_progress']).optional(),
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
