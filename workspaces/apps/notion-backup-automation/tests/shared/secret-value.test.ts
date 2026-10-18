import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';

import { createLogger } from '../../src/shared/logger.js';
import { redact } from '../../src/shared/redact.js';
import { SecretValue } from '../../src/shared/secret-value.js';

const link = 'https://mg.mail.notion.com/c/fixture-not-a-real-link';

describe('SecretValue', () => {
  it('reveals the value only on request', () => {
    expect(new SecretValue(link).reveal()).toBe(link);
  });

  it('shows only [redacted] when serialized, printed, inspected or redacted', () => {
    const secret = new SecretValue(link);

    expect(JSON.stringify({ secret })).toBe('{"secret":"[redacted]"}');
    expect(String(secret)).toBe('[redacted]');
    expect(inspect({ secret }, { depth: 5 })).not.toContain('mg.mail');
    expect(JSON.stringify(redact({ link: secret }))).not.toContain('mg.mail');
  });

  it('never reaches a log line', () => {
    const lines: string[] = [];
    const logger = createLogger({
      sink: (_level, line) => {
        lines.push(line);
      },
    });

    logger.info('transfer.start', { download: new SecretValue(link) });

    expect(lines.join('\n')).not.toContain('mg.mail');
  });
});
