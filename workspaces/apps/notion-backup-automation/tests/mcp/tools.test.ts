import type { Client } from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';

import { SchedulerError } from '../../src/adapters/qstash/qstash-scheduler.js';
import { IntegrationError } from '../../src/application/integration-error.js';
import { MCP_SERVER_NAME } from '../../src/mcp/server.js';
import { storedJob } from '../support/backup-harness.js';
import type { McpHarness } from '../support/mcp.js';
import { connectClient, defaultSettings, mcpHarness } from '../support/mcp.js';

interface ToolCall {
  readonly isError: boolean;
  readonly output: Record<string, unknown>;
  readonly text: string;
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolCall> {
  const result = await client.callTool({ arguments: args, name });
  const [first] = result.content as { text?: string; type: string }[];

  return {
    isError: result.isError === true,
    output: (result.structuredContent ?? {}) as Record<string, unknown>,
    text: first?.text ?? '',
  };
}

async function outputOf(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const { output } = await call(client, name, args);

  return output;
}

async function connected(harness: McpHarness = mcpHarness(), mode: 'auto' | 'legacy' = 'legacy') {
  return { client: await connectClient(harness.serve, mode), harness };
}

describe('the MCP tools', () => {
  it('lists the 7 tools with their annotations, for both protocol eras', async () => {
    for (const mode of ['legacy', 'auto'] as const) {
      const { client } = await connected(mcpHarness(), mode);
      const { tools } = await client.listTools();

      expect(client.getServerVersion()?.name).toBe(MCP_SERVER_NAME);
      expect(Object.fromEntries(tools.map((tool) => [tool.name, tool.annotations]))).toEqual({
        backup_cancel: { destructiveHint: true },
        backup_health: { readOnlyHint: true },
        backup_list: { readOnlyHint: true },
        backup_process: { idempotentHint: true },
        backup_retry: { destructiveHint: false },
        backup_start: { idempotentHint: false, openWorldHint: true },
        backup_status: { readOnlyHint: true },
      });
      expect(tools.every((tool) => tool.outputSchema !== undefined)).toBe(true);
      await client.close();
    }
  });

  it('backup_start returns the CREATED job at once with an immediate wakeup, and is idempotent', async () => {
    const { client, harness } = await connected();

    const first = await call(client, 'backup_start', { reason: 'monthly' });

    expect(first).toMatchObject({
      isError: false,
      output: {
        created: true,
        jobId: '2026-10',
        nextCheckInMinutes: 0,
        period: '2026-10',
        status: 'CREATED',
      },
    });
    expect(first.text).toContain('Job 2026-10 created');
    expect(harness.qstash.published).toEqual([
      expect.objectContaining({ delaySec: 0, jobId: '2026-10', reason: 'start' }),
    ]);

    const again = await call(client, 'backup_start');

    expect(again.output).toMatchObject({ created: false, jobId: '2026-10', status: 'CREATED' });
    await expect(harness.memory.list({ limit: 10 })).resolves.toHaveLength(1);
  });

  it('backup_start with force refuses while a job is active, and starts r2 once it ended', async () => {
    const { client, harness } = await connected();

    await call(client, 'backup_start');

    expect(await call(client, 'backup_start', { force: true })).toMatchObject({
      isError: true,
      output: { code: 'ACTIVE_JOB_EXISTS' },
    });

    await harness.drain();

    expect(await outputOf(client, 'backup_start', { force: true })).toMatchObject({
      created: true,
      jobId: '2026-10-r2',
    });

    // The same call again, once r2 ended, starts r3: why backup_start is not idempotentHint.
    await harness.drain();

    expect(await outputOf(client, 'backup_start', { force: true })).toMatchObject({
      created: true,
      jobId: '2026-10-r3',
    });
  });

  it('backup_status shows the active or latest job, with its result once COMPLETE', async () => {
    const { client, harness } = await connected();

    expect(await call(client, 'backup_status')).toMatchObject({
      isError: true,
      output: { code: 'JOB_NOT_FOUND', message: 'No backup job exists yet' },
    });

    await call(client, 'backup_start');
    await harness.drain();

    const status = await call(client, 'backup_status', { jobId: '2026-10' });

    expect(status.isError).toBe(false);
    expect(status.output).toMatchObject({
      exportAttempt: 1,
      jobId: '2026-10',
      kind: 'manual',
      result: { fileName: expect.stringMatching(/^notion-workspace-/) },
      status: 'COMPLETE',
    });
    expect(status.output).not.toHaveProperty('nextCheckAt');
    expect(status.output).not.toHaveProperty('stage');
    expect(status.output.recentEvents).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'transition' })]),
    );
    expect(status.text).toMatch(/^Job 2026-10: COMPLETE\n\{/);
  });

  it('backup_status shows what needs attention, with the catalog’s reason and fix', async () => {
    const { client, harness } = await connected();

    harness.trigger.script = [new IntegrationError('NOTION_SESSION_EXPIRED')];
    await call(client, 'backup_start');
    await harness.drain();

    expect(await outputOf(client, 'backup_status')).toMatchObject({
      attention: {
        code: 'NOTION_SESSION_EXPIRED',
        howToFix: expect.stringContaining('auth:notion'),
        stage: 'NOTION_TRIGGER',
      },
      stage: 'NOTION_TRIGGER',
      status: 'NEEDS_ATTENTION',
    });
  });

  it('refuses a malformed job ID before any application method runs', async () => {
    const { client } = await connected();

    expect(await call(client, 'backup_status', { jobId: '../../etc' })).toMatchObject({
      isError: true,
    });
  });

  it('backup_list returns the newest jobs first, within the limit', async () => {
    const { client, harness } = await connected();

    await call(client, 'backup_start');
    await harness.drain();
    await call(client, 'backup_start', { force: true });

    const list = await call(client, 'backup_list', { limit: 1 });

    expect(list.output).toEqual({
      jobs: [expect.objectContaining({ jobId: '2026-10-r2', kind: 'forced', status: 'CREATED' })],
    });
    const all = await outputOf(client, 'backup_list');

    expect((all.jobs as { jobId: string }[]).map((job) => job.jobId)).toEqual([
      '2026-10-r2',
      '2026-10',
    ]);
    expect(await call(client, 'backup_list', { limit: 25 })).toMatchObject({ isError: true });
  });

  it('backup_process queues a wakeup, not for an ended job, and at most 10 times per job and hour', async () => {
    const { client, harness } = await connected();

    await call(client, 'backup_start');

    expect(await outputOf(client, 'backup_process', { jobId: '2026-10' })).toEqual({
      jobId: '2026-10',
      queued: true,
      reason: 'queued',
      status: 'CREATED',
    });

    for (let index = 2; index <= 10; index += 1) {
      await call(client, 'backup_process', { jobId: '2026-10' });
    }

    const published = harness.qstash.published.length;

    expect(await call(client, 'backup_process', { jobId: '2026-10' })).toMatchObject({
      isError: true,
      output: { code: 'RATE_LIMITED' },
    });
    expect(harness.qstash.published).toHaveLength(published);

    harness.clock.advance(60 * 60 * 1000);
    await harness.drain();

    expect(await outputOf(client, 'backup_process', { jobId: '2026-10' })).toMatchObject({
      queued: false,
      reason: 'terminal',
      status: 'COMPLETE',
    });
  });

  it('backup_retry resumes a job that needs attention, and refuses one that does not', async () => {
    const { client, harness } = await connected();

    harness.trigger.script = [new IntegrationError('NOTION_SESSION_EXPIRED')];
    await call(client, 'backup_start');
    await harness.drain();

    expect(await outputOf(client, 'backup_retry', { jobId: '2026-10' })).toEqual({
      jobId: '2026-10',
      queued: true,
      resumeFrom: 'NOTION_TRIGGER',
      status: 'TRIGGERING_EXPORT',
    });

    await harness.drain();

    expect(await call(client, 'backup_retry', { jobId: '2026-10' })).toMatchObject({
      isError: true,
      output: { code: 'INVALID_STATE' },
    });
    expect(await call(client, 'backup_retry', { jobId: '2026-11' })).toMatchObject({
      isError: true,
      output: { code: 'JOB_NOT_FOUND' },
    });
  });

  it('backup_cancel ends an active job, needs a reason, and refuses an ended one', async () => {
    const { client, harness } = await connected();

    await call(client, 'backup_start');

    expect(await call(client, 'backup_cancel', { jobId: '2026-10', reason: '' })).toMatchObject({
      isError: true,
    });
    await expect(storedJob(harness, '2026-10')).resolves.toMatchObject({ status: 'CREATED' });

    expect(
      await outputOf(client, 'backup_cancel', { jobId: '2026-10', reason: 'testing' }),
    ).toEqual({ jobId: '2026-10', status: 'CANCELLED' });
    expect(
      await call(client, 'backup_cancel', { jobId: '2026-10', reason: 'again' }),
    ).toMatchObject({ isError: true, output: { code: 'INVALID_STATE' } });
  });

  it('backup_health shows the stored probe results and the settings, never a browser run', async () => {
    const { client, harness } = await connected();

    await harness.health.write('notionSession', {
      authCookieExpiresAt: '2027-10-27T00:00:00.000Z',
      checkedAt: '2026-10-01T04:00:00.000Z',
      exportDialog: 'ready',
      state: 'valid',
    });
    await harness.health.write('qstashPing', {
      nonce: 'nonce_0123456789',
      receivedAt: '2026-10-01T03:00:00.000Z',
    });
    await harness.health.write('cron', { ok: true, ranAt: '2026-10-01T04:27:00.000Z' });

    const health = await call(client, 'backup_health');

    expect(health.output).toEqual({
      agent: defaultSettings.agent,
      autoStartEnabled: false,
      heartbeat: { configured: true },
      lastCron: { ok: true, ranAt: '2026-10-01T04:27:00.000Z' },
      notifications: { channels: ['console', 'telegram'], missing: [] },
      notionSession: {
        authCookieExpiresAt: '2027-10-27T00:00:00.000Z',
        checkedAt: '2026-10-01T04:00:00.000Z',
        exportDialog: 'ready',
        state: 'valid',
      },
      qstash: { lastPingAt: '2026-10-01T03:00:00.000Z' },
    });
    expect(health.text).toMatch(/^Notion valid · Google not checked · Drive not checked/);
    expect(harness.trigger.clicks).toEqual([]);
  });

  it('reports a failed publish as SCHEDULER_UNAVAILABLE, without QStash’s reply', async () => {
    const { client, harness } = await connected();

    harness.qstash.onPublish = () => Promise.reject(new SchedulerError('publish'));

    expect(await call(client, 'backup_start')).toMatchObject({
      isError: true,
      output: { code: 'SCHEDULER_UNAVAILABLE' },
    });
  });

  it('reports an unexpected failure as INTERNAL_ERROR and logs it, never its message', async () => {
    const harness = mcpHarness({
      overrides: {
        health: { read: () => Promise.reject(new Error('redis at https://u:p@db.example?x=1')) },
      },
    });
    const { client } = await connected(harness);

    const result = await call(client, 'backup_health');

    expect(result).toMatchObject({ isError: true, output: { code: 'INTERNAL_ERROR' } });
    expect(JSON.stringify(result)).not.toContain('db.example');
    expect(harness.logs).toContainEqual(
      expect.objectContaining({ event: 'mcp.tool_failed', tool: 'backup_health' }),
    );
  });

  it('serves the same tools to a 2026-07-28 client', async () => {
    const { client, harness } = await connected(mcpHarness(), 'auto');

    expect(await outputOf(client, 'backup_start')).toMatchObject({ created: true });
    await harness.drain();
    expect(await outputOf(client, 'backup_status')).toMatchObject({ status: 'COMPLETE' });
  });
});
