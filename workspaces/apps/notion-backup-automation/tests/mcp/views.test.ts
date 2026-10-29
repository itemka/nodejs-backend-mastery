import { describe, expect, it } from 'vitest';

import type { McpEnv } from '../../src/config/env.js';
import type { JobEvent } from '../../src/domain/job-event.js';
import type { BackupJob } from '../../src/domain/job.js';
import {
  healthSettingsFrom,
  healthView,
  jobSummary,
  jobSummarySchema,
  jobView,
  jobViewSchema,
} from '../../src/mcp/views.js';
import { TEST_TOKEN } from '../support/fixture-secrets.js';
import { attentionJob, completeJob, retryableJob, waitingJob } from '../support/jobs.js';
import { defaultSettings } from '../support/mcp.js';

const SIGNED_URL = 'https://file.notion.com/f/t/export.zip?signature=abc123';
const MAILGUN_URL = 'https://mg.mail.notion.com/c/eyJhbGciOiJIUzI1NiJ9.e30.abcdefgh';
const SCHEDULE_TOKEN = TEST_TOKEN;

/** A job with every field set, including the ones no view may show. */
function loadedJob(): BackupJob {
  return {
    ...waitingJob(),
    emailMessageId: 'gmail-message-0123',
    schedule: {
      messageId: 'msg_qstash_0123456789',
      notBefore: '2026-10-01T04:20:00.000Z',
      token: SCHEDULE_TOKEN,
    },
  };
}

const poisonedEvents: JobEvent[] = [
  { at: '2026-10-01T04:01:00.000Z', text: `email link ${SIGNED_URL}`, type: 'note' },
  { at: '2026-10-01T04:02:00.000Z', text: `tracking ${MAILGUN_URL}`, type: 'note' },
  {
    at: '2026-10-01T04:03:00.000Z',
    text: 'cookie token_v2=v02%3Auser_token_abcdef; Bearer ya29.a0AfH6SMBxyz',
    type: 'note',
  },
];

describe('the view mappers', () => {
  it('build backup_status from an allowlist: no token, message, email or folder ID', () => {
    const view = jobView(loadedJob(), poisonedEvents);
    const json = JSON.stringify(view);

    expect(jobViewSchema.parse(view)).toEqual(view);
    expect(view).toMatchObject({
      jobId: '2026-10',
      nextCheckAt: '2026-10-01T04:20:00.000Z',
      stage: 'EMAIL_WAIT',
      status: 'WAITING_FOR_EMAIL',
    });

    for (const secret of [SCHEDULE_TOKEN, 'msg_qstash', 'gmail-message', 'yearFolderId']) {
      expect(json).not.toContain(secret);
    }
  });

  it('show the supervisor’s summary with the incident, and an incident only while it waits', () => {
    const waiting = attentionJob('NOTION_UI_CHANGED');
    const handedOver: BackupJob = {
      ...waiting,
      incident: {
        ...waiting.incident!,
        state: 'awaiting_user',
        supervisorSummary: 'The Settings page changed. See https://evil.example/?token=1',
      },
    };
    // A supervisor retry_stage keeps the incident on the working job until it moves on.
    const retrying: BackupJob = { ...waitingJob(), incident: waiting.incident! };

    expect(jobView(handedOver, []).attention).toEqual({
      code: 'NOTION_UI_CHANGED',
      howToFix: 'Update the Notion Settings page object, then run backup_retry.',
      reason: 'The Notion Settings page did not match the expected layout.',
      stage: 'NOTION_TRIGGER',
      supervisorSummary: 'The Settings page changed. See [link]',
    });
    expect(jobView(retrying, []).attention).toBeUndefined();
    expect(jobSummary(retrying).attentionCode).toBeUndefined();
  });

  it('never emit a URL or token-shaped text, even from a poisoned event', () => {
    const json = JSON.stringify([
      jobView({ ...completeJob(), schedule: loadedJob().schedule }, poisonedEvents),
      jobSummary(completeJob()),
    ]);

    expect(json).not.toMatch(/https?:\/\//);
    expect(json).not.toMatch(/eyJ|ya29\.|v02%3A|signature=/);
  });

  it('show no next check once a job ended, and the stored result', () => {
    const view = jobView({ ...completeJob(), schedule: loadedJob().schedule }, []);

    expect(view).not.toHaveProperty('nextCheckAt');
    expect(view).not.toHaveProperty('stage');
    expect(view.result).toEqual({
      driveFileId: completeJob().result?.driveFileId,
      entryCount: completeJob().result?.entryCount,
      fileName: completeJob().result?.fileName,
      sha256: completeJob().result?.sha256,
      sizeBytes: completeJob().result?.sizeBytes,
    });
  });

  it('show what needs attention with the catalog’s text, also for a retrying job', () => {
    expect(jobView(attentionJob('GOOGLE_AUTH_REQUIRED'), []).attention).toMatchObject({
      code: 'GOOGLE_AUTH_REQUIRED',
      howToFix: expect.stringContaining('auth:google'),
    });
    expect(jobSummary(retryableJob())).toMatchObject({ attentionCode: expect.any(String) });
    expect(jobView(waitingJob(), []).attention).toBeUndefined();
  });

  it('keep the 10 newest events, oldest first', () => {
    const events = Array.from({ length: 15 }, (_, index) => ({
      at: `2026-10-01T04:${String(index).padStart(2, '0')}:00.000Z`,
      text: `event ${index}`,
      type: 'note' as const,
    }));

    expect(jobView(waitingJob(), events).recentEvents.map((event) => event.text)).toEqual(
      Array.from({ length: 10 }, (_, index) => `event ${index + 5}`),
    );
  });

  it('summarize a job for backup_list', () => {
    const summary = jobSummary(completeJob());

    expect(jobSummarySchema.parse(summary)).toEqual(summary);
    expect(summary).toMatchObject({ jobId: '2026-10', shrunk: false, status: 'COMPLETE' });
  });

  it('build backup_health from the stored probes and the settings only', () => {
    const view = healthView(
      {
        driveRoot: { checkedAt: '2026-10-01T04:00:00.000Z', mode: 'existing', ok: true },
        qstashPing: { nonce: 'nonce_secret_0123', receivedAt: '2026-10-01T03:00:00.000Z' },
      },
      defaultSettings,
    );

    expect(view).toEqual({
      agent: defaultSettings.agent,
      autoStartEnabled: false,
      driveRoot: { checkedAt: '2026-10-01T04:00:00.000Z', mode: 'existing', ok: true },
      heartbeat: { configured: true },
      notifications: defaultSettings.notifications,
      qstash: { lastPingAt: '2026-10-01T03:00:00.000Z' },
    });
    expect(JSON.stringify(view)).not.toContain('nonce_secret');
  });
});

describe('healthSettingsFrom', () => {
  const env: Parameters<typeof healthSettingsFrom>[0] = {
    AGENT_MODEL_NAME: 'gemini-3.6-flash',
    AGENT_MODEL_PROVIDER: 'gemini',
    AUTO_START_ENABLED: true,
    GEMINI_API_KEY: undefined,
    HEARTBEAT_PING_URL: false,
    NOTIFIERS: ['console', 'telegram'],
    TELEGRAM_HUB_TOKEN: true,
    TELEGRAM_HUB_URL: false,
  } satisfies Partial<McpEnv>;

  it('names a listed channel’s missing variables, and leaves the channel out', () => {
    expect(healthSettingsFrom(env)).toEqual({
      agent: { configured: false, model: 'gemini-3.6-flash', provider: 'gemini' },
      autoStartEnabled: true,
      heartbeatConfigured: false,
      notifications: { channels: ['console'], missing: ['TELEGRAM_HUB_URL'] },
    });
  });

  it('counts Telegram once both variables are set, and the agent off as configured', () => {
    expect(
      healthSettingsFrom({ ...env, AGENT_MODEL_PROVIDER: 'none', TELEGRAM_HUB_URL: true }),
    ).toMatchObject({
      agent: { configured: true, provider: 'none' },
      notifications: { channels: ['console', 'telegram'], missing: [] },
    });
  });
});
