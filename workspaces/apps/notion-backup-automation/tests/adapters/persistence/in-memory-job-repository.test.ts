import { describe, expect, it } from 'vitest';

import { InMemoryJobRepository } from '../../../src/adapters/persistence/in-memory-job-repository.js';
import { describeJobRepositoryContract } from '../../contract/job-repository.contract.js';
import { ManualClock } from '../../support/manual-clock.js';

describeJobRepositoryContract('in-memory fake', () => {
  const clock = new ManualClock('2026-10-01T04:00:00.000Z');

  return {
    advance: (ms) => {
      clock.advance(ms);

      return Promise.resolve();
    },
    repository: new InMemoryJobRepository(clock),
  };
});

describe('InMemoryJobRepository', () => {
  it('reports a corrupted record as STATE_SCHEMA_INVALID instead of returning it', async () => {
    const repository = new InMemoryJobRepository();

    repository.putRawJob('2026-10', '{"schemaVersion":1,"id":"2026-10"}');

    await expect(repository.get('2026-10')).rejects.toMatchObject({ code: 'STATE_SCHEMA_INVALID' });
  });
});
