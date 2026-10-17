import { describe, expect, it } from 'vitest';

import type { LogLevel } from '../../src/shared/logger.js';
import { createLogger } from '../../src/shared/logger.js';
import { REDACTED } from '../../src/shared/redact.js';

const clock = { now: () => new Date('2026-10-01T12:00:00.000Z') };

function capture(level?: LogLevel) {
  const lines: { level: LogLevel; record: Record<string, unknown> }[] = [];
  const logger = createLogger({
    clock,
    sink: (lineLevel, line) => {
      lines.push({ level: lineLevel, record: JSON.parse(line) as Record<string, unknown> });
    },
    ...(level === undefined ? {} : { level }),
  });

  return { lines, logger };
}

describe('createLogger', () => {
  it('writes one JSON line per call with time, level and event', () => {
    const { lines, logger } = capture();

    logger.info('job.transition', { from: 'CREATED', to: 'TRIGGERING_EXPORT' });

    expect(lines).toEqual([
      {
        level: 'info',
        record: {
          event: 'job.transition',
          from: 'CREATED',
          level: 'info',
          time: '2026-10-01T12:00:00.000Z',
          to: 'TRIGGERING_EXPORT',
        },
      },
    ]);
  });

  it('drops lines below the configured level', () => {
    const { lines, logger } = capture('warn');

    logger.debug('a');
    logger.info('b');
    logger.warn('c');
    logger.error('d');

    expect(lines.map((line) => line.record.event)).toEqual(['c', 'd']);
  });

  it('adds child bindings to every line, and nests children', () => {
    const { lines, logger } = capture();
    const tick = logger.child({ jobId: '2026-10', period: '2026-10' }).child({ tickId: 't1' });

    tick.info('tick.start');

    expect(lines[0]?.record).toMatchObject({ jobId: '2026-10', period: '2026-10', tickId: 't1' });
  });

  it('does not let fields override time, level or event', () => {
    const { lines, logger } = capture();

    logger.child({ level: 'debug' }).info('real', { event: 'fake', time: 'fake' });

    expect(lines[0]?.record).toMatchObject({
      event: 'real',
      level: 'info',
      time: '2026-10-01T12:00:00.000Z',
    });
  });

  it('always redacts fields, bindings and errors', () => {
    const { lines, logger } = capture();

    logger.child({ cookie: 'token_v2=abc' }).error('download.failed', {
      err: new Error('GET https://h.example.com/p?sig=1'),
      token: 'x',
    });

    const record: Record<string, unknown> = lines[0]?.record ?? {};

    expect(record.cookie).toBe(REDACTED);
    expect(record.token).toBe(REDACTED);
    expect(record.err).toMatchObject({ message: `GET https://h.example.com/p${REDACTED}` });
    expect(JSON.stringify(record)).not.toMatch(/https?:\/\/[^" ]*\?/);
  });
});
