import { describe, expect, it } from 'vitest';

import { IntegrationError } from '../../src/application/integration-error.js';
import type { NotionLoginRequestOutcome } from '../../src/application/notion-auto-login.js';
import type { NotionLoginTrigger } from '../../src/application/ports.js';
import { backupHarness, storedJob } from '../support/backup-harness.js';

/* Phase 14: a tick that finds the Notion session gone asks for the automatic login. */
function setup(request: () => Promise<NotionLoginRequestOutcome>) {
  const asked: NotionLoginTrigger[] = [];
  const harness = backupHarness({
    notionLogin: {
      request: (trigger) => {
        asked.push(trigger);

        return request();
      },
    },
  });

  return { asked, harness };
}

describe('ProcessJobUseCase and the automatic Notion login', () => {
  it('waits for you as before, and asks for one login', async () => {
    const { asked, harness } = setup(() => Promise.resolve('queued'));

    harness.trigger.script = [new IntegrationError('NOTION_SESSION_EXPIRED')];
    await harness.service.start();
    await harness.drain();

    await expect(storedJob(harness, '2026-10')).resolves.toMatchObject({
      incident: { code: 'NOTION_SESSION_EXPIRED', state: 'awaiting_user' },
      status: 'NEEDS_ATTENTION',
    });
    expect(harness.sent.map((record) => record.kind)).toContain('attention');
    expect(asked).toEqual(['expired']);
  });

  it('asks nothing for another code the login would not fix', async () => {
    const { asked, harness } = setup(() => Promise.resolve('queued'));

    harness.trigger.script = [new IntegrationError('NOTION_WRONG_WORKSPACE')];
    await harness.service.start();
    await harness.drain();

    expect(asked).toEqual([]);
  });

  it('never fails the tick when asking fails', async () => {
    const { asked, harness } = setup(() => Promise.reject(new Error('Redis down')));

    harness.trigger.script = [new IntegrationError('NOTION_SESSION_EXPIRED')];
    await harness.service.start();
    await harness.drain();

    expect(asked).toEqual(['expired']);
    await expect(storedJob(harness, '2026-10')).resolves.toMatchObject({
      status: 'NEEDS_ATTENTION',
    });
    expect(harness.logs.map((line) => line.event)).toContain('job.notion_login.failed');
  });
});
