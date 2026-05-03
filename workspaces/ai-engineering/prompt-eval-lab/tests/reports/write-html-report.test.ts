import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  PASS_SCORE,
  renderHtmlReport,
  writeHtmlReport,
} from '../../src/reports/write-html-report.js';
import { buildPayload, makeResult } from './report-fixtures.js';

describe('writeHtmlReport', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'eval-report-'));
  });

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true });
  });

  it('writes a prompt evaluation report page', async () => {
    const file = path.join(tempDir, 'nested', 'out.html');
    await writeHtmlReport(file, buildPayload([makeResult()]));

    const written = await readFile(file, 'utf8');

    expect(written).toContain('<title>Prompt Evaluation Report</title>');
    expect(written).toContain('Total Test Cases');
    expect(written).toContain('JSON extraction scenario');
    expect(written).toContain('<strong>content:</strong>');
    expect(written).toContain(`Pass Rate (&ge;${PASS_SCORE})`);
  });
});

describe('renderHtmlReport', () => {
  it('escapes model output in the HTML report', () => {
    const html = renderHtmlReport(
      buildPayload([
        makeResult({
          output: '<script>alert("x")</script>',
        }),
      ]),
    );

    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert');
  });

  it('applies score-good, score-mid, and score-low CSS classes by threshold', () => {
    const html = renderHtmlReport(
      buildPayload([makeResult({ score: 9 }), makeResult({ score: 5 }), makeResult({ score: 2 })]),
    );

    expect(html).toContain('class="badge score-good"');
    expect(html).toContain('class="badge score-mid"');
    expect(html).toContain('class="badge score-low"');
  });

  it('renders 0.0% pass rate and an empty table body for empty results', () => {
    const html = renderHtmlReport(buildPayload([]));

    expect(html).toContain('0.0%');
    expect(html).toContain(`Pass Rate (&ge;${PASS_SCORE})`);
    expect(html).not.toContain('<td>');
  });
});
