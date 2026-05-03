import { createProvider } from '@workspaces/packages/llm-client';

import { loadConfig, loadEnvironment } from '../config/env.js';
import { loadDataset } from '../datasets/load-dataset.js';
import { runEval } from '../eval/runner.js';
import { formatSummaryLines, summarize } from '../eval/summary.js';
import { loadTemplate } from '../prompts/templates.js';
import {
  defaultReportPath,
  PASS_SCORE,
  type ReportPayload,
  writeReport,
} from '../reports/write-report.js';
import type { CliOptions } from './args.js';

export interface RunEvalIo {
  readonly logLine?: (line: string) => void;
}

export async function runEvalCli(options: CliOptions, io: RunEvalIo = {}): Promise<void> {
  const log = io.logLine ?? ((line: string) => console.log(line));

  loadEnvironment();
  const config = loadConfig();
  const provider = createProvider(config);
  const promptTemplate = await loadTemplate(options.templateName);
  const dataset = await loadDataset(options.datasetPath);
  const model = options.model ?? config.model;
  const startedAt = new Date();

  log(
    `Running ${dataset.length} test case(s) with template "${options.templateName}" against model ${model}...`,
  );

  const results = await runEval(dataset, {
    concurrency: options.concurrency,
    model,
    promptTemplate,
    provider,
    ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
  });

  const finishedAt = new Date();
  const summary = summarize(results);

  for (const line of formatSummaryLines(summary)) {
    log(line);
  }

  const payload: ReportPayload = {
    metadata: {
      concurrency: options.concurrency,
      datasetPath: options.datasetPath,
      finishedAt: finishedAt.toISOString(),
      model,
      startedAt: startedAt.toISOString(),
      templateName: options.templateName,
    },
    passScore: PASS_SCORE,
    results,
    summary,
  };

  const filePath = options.outPath ?? defaultReportPath('reports', finishedAt);
  const format = await writeReport(filePath, payload);
  log(`Wrote ${format.toUpperCase()} report to ${filePath}`);
}
