import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { EvalResult } from '../eval/types.js';
import type { ReportPayload } from './types.js';

export const PASS_SCORE = 9;
const SCORE_MID_THRESHOLD = 4;

export async function writeHtmlReport(filePath: string, payload: ReportPayload): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, renderHtmlReport(payload), 'utf8');
}

export function renderHtmlReport(payload: ReportPayload): string {
  const { passScore } = payload;
  const rows = payload.results.map((result) => renderResultRow(result, passScore)).join('\n');
  const passRate = percentage(passCount(payload.results, passScore), payload.summary.total);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Prompt Evaluation Report</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f2f3f5;
      --panel: #ffffff;
      --border: #d8dbe0;
      --header: #3a3a3a;
      --muted: #5e6570;
      --text: #1f2933;
      --score-good-bg: #dcfce7;
      --score-good-text: #166534;
      --score-mid-bg: #fef3c7;
      --score-mid-text: #92400e;
      --score-low-bg: #ffe4e6;
      --score-low-text: #be123c;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font: 14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    main {
      padding: 24px;
    }

    h1 {
      margin: 0 0 24px;
      font-size: 30px;
      line-height: 1.15;
    }

    .summary {
      display: grid;
      grid-template-columns: repeat(3, minmax(180px, 1fr));
      gap: 24px;
      margin-bottom: 24px;
      padding: 16px;
      background: #eceeef;
      border-radius: 2px;
    }

    .card {
      min-height: 96px;
      padding: 18px;
      background: var(--panel);
      border: 1px solid #e6e8eb;
      border-radius: 4px;
      box-shadow: 0 2px 7px rgb(15 23 42 / 0.12);
    }

    .card-label {
      margin-bottom: 12px;
      color: #3f4650;
      font-weight: 650;
    }

    .card-value {
      font-size: 24px;
      font-weight: 750;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--panel);
    }

    th {
      padding: 14px 12px;
      background: var(--header);
      color: #fff;
      text-align: left;
      font-weight: 700;
      vertical-align: top;
    }

    td {
      padding: 14px 12px;
      border-bottom: 1px solid var(--border);
      vertical-align: top;
    }

    .scenario {
      width: 20%;
      min-width: 220px;
    }

    .inputs,
    .criteria,
    .output,
    .reasoning {
      width: 20%;
      min-width: 240px;
    }

    .score {
      width: 72px;
      min-width: 72px;
      text-align: center;
    }

    .prompt-input,
    .criteria-line {
      margin: 0 0 6px;
    }

    .prompt-input strong {
      font-weight: 750;
    }

    pre {
      max-width: 420px;
      margin: 0;
      padding: 12px;
      overflow: auto;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      background: #f5f6f8;
      border: 1px solid var(--border);
      border-radius: 3px;
      font: 13px/1.45 "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    }

    .badge {
      display: inline-flex;
      min-width: 32px;
      min-height: 32px;
      align-items: center;
      justify-content: center;
      border-radius: 3px;
      font-weight: 800;
    }

    .score-good {
      background: var(--score-good-bg);
      color: var(--score-good-text);
    }

    .score-mid {
      background: var(--score-mid-bg);
      color: var(--score-mid-text);
    }

    .score-low {
      background: var(--score-low-bg);
      color: var(--score-low-text);
    }

    .meta {
      margin: -14px 0 20px;
      color: var(--muted);
    }

    @media (max-width: 900px) {
      main {
        padding: 16px;
      }

      .summary {
        grid-template-columns: 1fr;
      }

      table {
        display: block;
        overflow-x: auto;
      }
    }
  </style>
</head>
<body>
  <main>
    <h1>Prompt Evaluation Report</h1>
    <p class="meta">Model: ${escapeHtml(payload.metadata.model)} | Dataset: ${escapeHtml(payload.metadata.datasetPath)} | Finished: ${escapeHtml(payload.metadata.finishedAt)}</p>
    <section class="summary" aria-label="Run summary">
      <article class="card">
        <div class="card-label">Total Test Cases</div>
        <div class="card-value">${payload.summary.total}</div>
      </article>
      <article class="card">
        <div class="card-label">Average Score</div>
        <div class="card-value">${formatScore(payload.summary.averageScore)} / 10</div>
      </article>
      <article class="card">
        <div class="card-label">Pass Rate (&ge;${passScore})</div>
        <div class="card-value">${passRate.toFixed(1)}%</div>
      </article>
    </section>
    <table>
      <thead>
        <tr>
          <th class="scenario">Scenario</th>
          <th class="inputs">Prompt Inputs</th>
          <th class="criteria">Solution Criteria</th>
          <th class="output">Output</th>
          <th class="score">Score</th>
          <th class="reasoning">Reasoning</th>
        </tr>
      </thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </main>
</body>
</html>
`;
}

function renderResultRow(result: EvalResult, passScore: number): string {
  return `        <tr>
          <td>${escapeMultiline(result.testCase.scenario ?? result.testCase.task)}</td>
          <td>${renderPromptInputs(result)}</td>
          <td>${renderCriteria(result.testCase.solution_criteria)}</td>
          <td><pre>${escapeHtml(result.output)}</pre></td>
          <td class="score"><span class="badge ${scoreClass(result.score, passScore)}">${formatScore(result.score)}</span></td>
          <td>${escapeMultiline(result.modelGrade.reasoning)}</td>
        </tr>`;
}

function renderPromptInputs(result: EvalResult): string {
  const entries = Object.entries(result.testCase.prompt_inputs ?? {});

  if (entries.length === 0) {
    return `<p class="prompt-input">${escapeMultiline(result.testCase.task)}</p>`;
  }

  return entries
    .map(
      ([key, value]) =>
        `<p class="prompt-input"><strong>${escapeHtml(key)}:</strong> ${escapeMultiline(value)}</p>`,
    )
    .join('');
}

function renderCriteria(criteria: string): string {
  const lines = criteria
    .split(/\r?\n|;\s*/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length <= 1) {
    return escapeMultiline(lines[0] ?? criteria);
  }

  return lines
    .map((line) => `<p class="criteria-line">&bull; ${escapeMultiline(line)}</p>`)
    .join('');
}

function passCount(results: readonly EvalResult[], passScore: number): number {
  return results.filter((result) => result.score >= passScore).length;
}

function percentage(count: number, total: number): number {
  return total === 0 ? 0 : (count / total) * 100;
}

function scoreClass(score: number, passScore: number): string {
  if (score >= passScore) {
    return 'score-good';
  }

  if (score >= SCORE_MID_THRESHOLD) {
    return 'score-mid';
  }

  return 'score-low';
}

function formatScore(score: number): string {
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}

function escapeMultiline(value: string): string {
  return escapeHtml(value).replaceAll('\n', '<br>');
}

function escapeHtml(value: string): string {
  return value.replaceAll(/[&<>"']/g, (char) => {
    switch (char) {
      case '&': {
        return '&amp;';
      }

      case '<': {
        return '&lt;';
      }

      case '>': {
        return '&gt;';
      }

      case '"': {
        return '&quot;';
      }

      case "'": {
        return '&#39;';
      }

      default: {
        return char;
      }
    }
  });
}
