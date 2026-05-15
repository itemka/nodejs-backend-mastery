# claude-capabilities-lab

Terminal lab for manually testing Claude-specific Anthropic capabilities through
[`@workspaces/packages/llm-client`](../../packages/llm-client) and the
`@anthropic-ai/sdk`. Scenarios are intentionally scoped and require a real
`ANTHROPIC_API_KEY` for live runs. Unit tests use fake providers and mocked SDK
clients; **no live Anthropic calls are made in CI**.

> Manual scenarios consume Anthropic credits. Run them deliberately.

## Setup

1. Copy `.env.example` to `.env` in this directory:
   ```bash
   cp workspaces/ai-engineering/claude-capabilities-lab/.env.example \
      workspaces/ai-engineering/claude-capabilities-lab/.env
   ```
2. Set `ANTHROPIC_API_KEY`. Optionally override `ANTHROPIC_MODEL`
   (default: `claude-sonnet-4-6`).
3. Install dependencies from the repo root: `pnpm install`.

Sample assets live under `samples/` and are committed as small fixtures so the
scenarios are runnable out of the box (images, a PDF, a CSV, and a text file).
Replace them with your own files in `samples/images/`, `samples/documents/`,
`samples/text/`, or `samples/data/` as needed. The lab validates file types and
sizes before sending data to Anthropic.

Generated outputs are written under `outputs/` and ignored by git.

## Commands

Run scenarios from the repo root via pnpm filters:

```bash
pnpm --filter claude-capabilities-lab dev -- <scenario> [options]
```

### thinking

```bash
pnpm --filter claude-capabilities-lab dev -- thinking \
  --thinking-mode=adaptive \
  --max-tokens=2048 \
  --prompt="Solve a small reasoning problem and explain the answer." \
  --show-thinking
```

Manual `enabled` thinking with an explicit budget:

```bash
pnpm --filter claude-capabilities-lab dev -- thinking \
  --thinking-mode=enabled \
  --thinking-budget-tokens=1500 \
  --max-tokens=3000 \
  --prompt="List three pros and cons of microservices." \
  --show-thinking
```

Disabled thinking sanity check:

```bash
pnpm --filter claude-capabilities-lab dev -- thinking \
  --thinking-mode=disabled \
  --prompt="What is the capital of France?"
```

Options:

- `--thinking-mode=adaptive|enabled|disabled` — default is `adaptive` when no
  budget is supplied, `enabled` when `--thinking-budget-tokens` is set.
- `--thinking-budget-tokens=<n>` — required for `enabled`; must be ≥1024 and
  less than `--max-tokens`.
- `--thinking-display=summarized|omitted` — adaptive display preference.
- `--show-thinking` — print summarized thinking blocks. Redacted thinking is
  shown as a placeholder.

> Manual `enabled` thinking is not accepted on Opus 4.7; use adaptive mode for
> Opus 4.6+ models.

Look for `=== Thinking ===` when `--show-thinking` is set and the model returns
thinking blocks. `adaptive` may omit thinking if the model chooses not to think;
`enabled` should return thinking on compatible models; `disabled` should not.

### image

```bash
pnpm --filter claude-capabilities-lab dev -- image \
  --image=samples/images/prop1.png \
  --prompt="Analyze this property image and produce a fire risk rating from 1-4."
```

The `image` scenario validates the file extension and PNG/JPEG/GIF/WebP magic
bytes, then encodes each image as base64. Repeat `--image=` to send multiple
images:

```bash
pnpm --filter claude-capabilities-lab dev -- image \
  --image=samples/images/prop1.png \
  --image=samples/images/prop2.png \
  --prompt="Compare these two property images."
```

Use the satellite/fire risk workflow as a manual prompt:

> Residence identification, tree overhang analysis, fire risk assessment,
> defensible space identification, final 1-4 rating.

To test preflight validation without spending credits, rename a JPEG as `.png`
and verify that the scenario throws a MIME mismatch before the API call.

### pdf

```bash
pnpm --filter claude-capabilities-lab dev -- pdf \
  --pdf=samples/documents/earth.pdf \
  --prompt="Summarize the document in one sentence."
```

Add `--citations` to enable PDF citations or `--cache` to add a cache breakpoint
on the document block.

```bash
pnpm --filter claude-capabilities-lab dev -- pdf \
  --pdf=samples/documents/earth.pdf \
  --citations \
  --prompt="What is this document's main topic?"

pnpm --filter claude-capabilities-lab dev -- pdf \
  --pdf=samples/documents/earth.pdf \
  --cache \
  --prompt="Summarize this document again."
```

With `--citations`, look for `=== Citations ===` entries with page ranges. With
`--cache`, run the same command twice within the TTL and check usage for a
non-zero `cache_read` on the second run.

### citations

```bash
pnpm --filter claude-capabilities-lab dev -- citations \
  --pdf=samples/documents/earth.pdf \
  --prompt="Answer with citations: what is the document about?"
```

Provide `--pdf=<path>`, `--text-document=<path>`, or both. Citations are always
enabled on every supplied document.

Validated manual examples:

```bash
pnpm --filter claude-capabilities-lab dev -- citations \
  --pdf=samples/documents/earth.pdf \
  --prompt="Answer with citations: what is the main topic?"

pnpm --filter claude-capabilities-lab dev -- citations \
  --text-document=samples/text/temp.txt \
  --prompt="Cite the key facts mentioned in this text."

pnpm --filter claude-capabilities-lab dev -- citations \
  --pdf=samples/documents/earth.pdf \
  --text-document=samples/text/temp.txt \
  --prompt="What are the main outcomes for these two documents?"
```

Look for `=== Citations ===` after the answer. PDF citations should render as
`page_location` ranges, for example `earth.pdf (pages 1-2)`. Text citations
should render as `char_location` ranges, for example `temp.txt (chars 826-1098)`.
Prompts that ask what unrelated documents "agree on" may produce a valid answer
with no citations because the model can decide there is no substantive shared
claim to cite.

### cache

```bash
pnpm --filter claude-capabilities-lab dev -- cache \
  --target=document \
  --document=samples/documents/earth.pdf \
  --prompt="Summarize this document again."
```

`--target` is one of `system`, `tools`, `document`, `image`, or `last-message`.
Use `--ttl=5m|1h` to override the cache TTL. The CLI prints cache usage from the
response (`cache_creation`, `cache_read`, TTL breakdown). `document` requires
`--document=<path>` and `image` requires `--image=<path>`.

Use a large stable target for a positive cache test:

```bash
pnpm --filter claude-capabilities-lab dev -- cache \
  --target=document \
  --document=samples/documents/earth.pdf \
  --prompt="Summarize the document." \
  --ttl=5m
```

Run the exact same command twice within 5 minutes. A positive result is:

```text
# First run
cache_creation=<non-zero>, cache_read=0

# Second run
cache_creation=0, cache_read=<non-zero>
```

Short `system`, `tools`, and `last-message` examples are not reliable positive
cache tests. Anthropic skips caching without an error when the cached prefix is
below the model's minimum cacheable length; in that case usage shows
`cache_creation=0, cache_read=0`.

### files

```bash
pnpm --filter claude-capabilities-lab dev -- files upload --file=samples/data/streaming.csv
pnpm --filter claude-capabilities-lab dev -- files list
pnpm --filter claude-capabilities-lab dev -- files metadata --file-id=file_abc
pnpm --filter claude-capabilities-lab dev -- files download --file-id=file_abc --out-dir=outputs
pnpm --filter claude-capabilities-lab dev -- files delete --file-id=file_abc
```

`files download` requires the file to be marked downloadable. Files are written
to `outputs/` with sanitized filenames; the lab refuses output paths that escape
`outputs/`.

Uploaded input files are usually returned with `downloadable=false`; they are
for reuse in Messages requests, not for downloading back. Download is for files
created by Code Execution or Skills. Use `files metadata --file-id=<id>` to check
the `downloadable` field before attempting a direct download.

### code-exec

```bash
pnpm --filter claude-capabilities-lab dev -- code-exec \
  --file=samples/data/streaming.csv \
  --download-outputs \
  --prompt="Run a detailed analysis to determine major drivers of churn..."
```

The scenario uploads the file via the Files API, sends a `container_upload`
block alongside the prompt, and enables the `code_execution_20250825` server
tool. Generated file IDs are printed. Use `--download-outputs` to retrieve
generated files into `--out-dir` (defaults to `outputs/`).

> Code execution containers retain state for up to 30 days, but every execution
> starts from a clean slate unless container reuse is explicitly implemented
> later. Re-import any libraries inside the prompt.

Validated summary-file download:

```bash
pnpm --filter claude-capabilities-lab dev -- code-exec \
  --file=samples/data/streaming.csv \
  --download-outputs \
  --out-dir=outputs \
  --max-tokens=12000 \
  --prompt='Load $INPUT_DIR/streaming.csv, compute descriptive statistics for each column, write the summary to $OUTPUT_DIR/streaming_summary.txt, and keep the final answer under 50 words.'
```

Validated PNG plot download:

```bash
pnpm --filter claude-capabilities-lab dev -- code-exec \
  --file=samples/data/streaming.csv \
  --download-outputs \
  --out-dir=outputs \
  --max-tokens=12000 \
  --prompt='Use code_execution. Read $INPUT_DIR/streaming.csv, create a concise churn analysis plot, save it as /tmp/churn_plot.png, copy it to $OUTPUT_DIR/churn_plot.png, and keep the final answer under 50 words.'
```

Use single quotes around prompts that contain `$INPUT_DIR` or `$OUTPUT_DIR` so
your shell does not expand those variables locally. A successful downloadable
run prints `generated file_id=file_...` followed by `Downloaded file_... ->
.../outputs/<name>`. If the raw response has `stop_reason: "max_tokens"`, raise
`--max-tokens` or tighten the prompt so Claude can finish the tool calls and
return generated output blocks.

## Validation

```bash
pnpm --filter claude-capabilities-lab typecheck
pnpm --filter claude-capabilities-lab test
pnpm --filter claude-capabilities-lab build
```

## Notes and limits

- The CLI uses non-streaming requests for predictable manual validation.
- Base64 image and PDF requests are subject to the 32 MB Messages request limit.
- The Files API accepts uploads up to 500 MB. Files persist until deleted.
- `.env` files and anything under `outputs/` are gitignored. Do not commit real
  API keys, remote file IDs, or generated outputs.
- Add `--debug-response` to inspect raw Anthropic response blocks when a manual
  scenario behaves unexpectedly.
- Run `pnpm --filter claude-capabilities-lab dev -- --help` or
  `pnpm --filter claude-capabilities-lab dev -- <scenario> help` to inspect
  flags without making a live Anthropic call.
