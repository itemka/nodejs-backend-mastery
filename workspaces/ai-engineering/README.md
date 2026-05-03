# AI Engineering

Small runnable examples for learning the Claude API, MCP, Claude Code workflows, and related AI engineering patterns.

Examples build on top of [`@workspaces/packages/llm-client`](../packages/llm-client/), a small provider-neutral wrapper around the Anthropic SDK.

## Examples

- [llm-chat](./llm-chat/) — interactive LLM chat CLI with multi-turn history, streaming, and structured output formats (JSON/CSV/HTML).
- [prompt-eval-lab](./prompt-eval-lab/) — automated prompt-evaluation pipeline that loads a JSON dataset, calls the model, and grades each response with a model-based grader plus code-based syntax validators.
