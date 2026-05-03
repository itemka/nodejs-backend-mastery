# Prompt Eval Lab

A small Node.js/TypeScript CLI that runs an automated prompt-evaluation pipeline against an Anthropic Claude model. Loads a JSON dataset of test cases, renders each one through a prompt template, asks the model to solve it, then grades each response with a model-based grader plus a code-based syntax validator.

Provider-neutral on top of [`@workspaces/packages/llm-client`](../../packages/llm-client) — Anthropic adapter today, others can be added without changing the eval pipeline.

## Run

Create `.env` in this folder:

```env
ANTHROPIC_API_KEY="your-api-key-here"
# Optional:
# ANTHROPIC_MODEL="claude-sonnet-4-6"
```

Install dependencies from the repository root:

```bash
pnpm install
```

Run the eval against the bundled example dataset:

```bash
pnpm dev -- --dataset=datasets/basic-code-assistant.dataset.json
```

Write a JSON report alongside the console output:

```bash
pnpm dev -- --dataset=datasets/basic-code-assistant.dataset.json --out=reports/run.json
```

From the repository root:

```bash
pnpm --filter prompt-eval-lab dev -- --dataset=datasets/basic-code-assistant.dataset.json
```

## CLI Options

| Flag                | Required | Default             | Notes                               |
| ------------------- | -------- | ------------------- | ----------------------------------- |
| `--dataset=<path>`  | yes      | —                   | JSON dataset file.                  |
| `--prompt=<name>`   | no       | `code-assistant.v1` | Registered prompt template.         |
| `--out=<path>`      | no       | (no file written)   | Write a JSON report to this path.   |
| `--model=<id>`      | no       | `ANTHROPIC_MODEL`   | Override env-configured model.      |
| `--max-tokens=<n>`  | no       | `1024`              | Max tokens per LLM call.            |
| `--concurrency=<n>` | no       | `3`                 | Parallel test cases. Range `1..10`. |
| `-h`, `--help`      | no       | —                   | Show help.                          |

## Dataset Format

Each test case has a `task`, a `format` (`json` | `typescript` | `regex`), and `solution_criteria`:

```json
[
  {
    "task": "Write a TypeScript function that does X.",
    "format": "typescript",
    "solution_criteria": "Function takes a string and returns a string."
  }
]
```

See [datasets/basic-code-assistant.dataset.json](datasets/basic-code-assistant.dataset.json) for a runnable example.

## Scoring

For each test case the runner produces:

- **`output`** — raw model response.
- **`modelGrade`** — structured grader response from a second LLM call: `{ strengths, weaknesses, reasoning, score }` (1–10), validated with Zod and Anthropic structured outputs (`output_config.format` JSON schema).
- **`syntaxScore`** — `10` if the output parses as the requested format, otherwise `0`. JSON via `JSON.parse`, regex via `new RegExp`, TypeScript via the `typescript` compiler API (`ts.transpileModule` with `reportDiagnostics`).
- **`score`** — average of `modelGrade.score` and `syntaxScore`.

The summary prints the overall average plus a per-format breakdown.

## Source Map

- `src/main.ts` — thin CLI bootstrap.
- `src/cli/args.ts` — flag parser.
- `src/cli/run-eval.ts` — orchestrates env load, dataset load, runner, summary, optional report file.
- `src/config/env.ts` — `.env` loading wrapper that supplies the local `.env` path to `@workspaces/packages/llm-client`.
- `src/datasets/types.ts`, `load-dataset.ts` — Zod-validated dataset model.
- `src/prompts/templates.ts`, `render-prompt.ts` — named-template registry and `{{var}}` interpolator.
- `src/eval/runner.ts` — single-case orchestration and dataset-level runner with bounded concurrency.
- `src/eval/concurrency.ts` — order-preserving `runWithConcurrency` helper.
- `src/eval/summary.ts` — pure summary + console formatter.
- `src/graders/code-validators.ts` — JSON / regex / TypeScript syntax validators.
- `src/graders/model-grader.ts` — model-based grader using structured outputs.
- `src/reports/write-json-report.ts` — JSON report writer.

## Testing

Unit tests mock the `LlmProvider`. No live API call in CI.

```bash
pnpm --filter prompt-eval-lab test
pnpm --filter prompt-eval-lab typecheck
```

Smoke run against the real Anthropic API requires `ANTHROPIC_API_KEY` and is not run in CI.

## Notes On Rate Limits

`--concurrency` defaults to `3` and is hard-clamped to `1..10`. Choose a value that fits your account's RPM/TPM. The runner does not retry on `429`; the error propagates so you can rerun with a lower concurrency.
