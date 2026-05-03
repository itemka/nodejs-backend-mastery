import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockWriteReport = vi.hoisted(() => vi.fn((_path: string) => 'html' as const));

vi.mock('@workspaces/packages/llm-client', () => ({ createProvider: vi.fn(() => ({})) }));
vi.mock('../../src/config/env.js', () => ({
  loadConfig: vi.fn(() => ({ model: 'stub-model' })),
  loadEnvironment: vi.fn(),
}));
vi.mock('../../src/datasets/load-dataset.js', () => ({ loadDataset: vi.fn(() => []) }));
vi.mock('../../src/prompts/templates.js', () => ({
  DEFAULT_TEMPLATE_NAME: 'code-assistant.v1',
  isTemplateName: () => true,
  loadTemplate: vi.fn(() => ''),
}));
vi.mock('../../src/eval/runner.js', () => ({
  DEFAULT_CONCURRENCY: 3,
  MAX_CONCURRENCY: 10,
  MIN_CONCURRENCY: 1,
  runEval: vi.fn(() => []),
}));
vi.mock('../../src/reports/write-report.js', () => ({
  defaultReportPath: (_dir: string, now: Date) =>
    `reports/${now.toISOString().replaceAll(':', '-')}.html`,
  PASS_SCORE: 9,
  writeReport: mockWriteReport,
}));

import { runEvalCli } from '../../src/cli/run-eval.js';

const BASE_OPTIONS = {
  concurrency: 3,
  datasetPath: '/tmp/test.json',
  templateName: 'code-assistant.v1' as const,
};

describe('runEvalCli', () => {
  beforeEach(() => {
    mockWriteReport.mockClear();
  });

  it('writes an HTML report to the default path when --out is absent', async () => {
    const logLines: string[] = [];
    await runEvalCli(BASE_OPTIONS, { logLine: (l) => logLines.push(l) });

    expect(mockWriteReport).toHaveBeenCalledOnce();
    expect(mockWriteReport).toHaveBeenCalledWith(
      expect.stringMatching(/^reports\/.*\.html$/),
      expect.objectContaining({ passScore: 9 }),
    );
    expect(logLines.some((l) => l.includes('HTML'))).toBe(true);
  });

  it('writes to the explicit --out path when provided', async () => {
    await runEvalCli({ ...BASE_OPTIONS, outPath: 'custom/out.json' }, {});

    expect(mockWriteReport).toHaveBeenCalledWith(
      'custom/out.json',
      expect.objectContaining({ passScore: 9 }),
    );
  });
});
