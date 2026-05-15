import type {
  LlmCacheControl,
  LlmContentBlock,
  LlmRequest,
  LlmSystemPromptBlock,
  LlmToolDefinition,
} from '../types.js';

export type CachingTarget = 'system' | 'tools' | 'document' | 'image' | 'last-message';

// Block types whose Anthropic shape supports a `cache_control` field and that
// our `LlmContentBlock` variants model with an optional `cacheControl`. Server
// tool result blocks (`web_search_tool_result`, `code_execution_tool_result`)
// are intentionally excluded because Anthropic does not accept `cache_control`
// on them and `LlmContentBlock` does not surface the field there.
const CACHEABLE_BLOCK_TYPES = new Set([
  'text',
  'image',
  'document',
  'tool_use',
  'tool_result',
  'server_tool_use',
  'container_upload',
]);

function withCacheControl<T extends LlmContentBlock>(block: T, cacheControl: LlmCacheControl): T {
  if (!CACHEABLE_BLOCK_TYPES.has(block.type)) {
    return block;
  }

  return { ...block, cacheControl } as T;
}

function withToolCacheControl(
  tool: LlmToolDefinition,
  cacheControl: LlmCacheControl,
): LlmToolDefinition {
  return { ...tool, cacheControl };
}

export function withSystemPromptCache(
  request: LlmRequest,
  cacheControl: LlmCacheControl,
): LlmRequest {
  const systemPrompt = request.systemPrompt;

  if (systemPrompt === undefined || systemPrompt === '') {
    return request;
  }

  if (typeof systemPrompt === 'string') {
    const block: LlmSystemPromptBlock = { cacheControl, text: systemPrompt, type: 'text' };

    return { ...request, systemPrompt: [block] };
  }

  if (systemPrompt.length === 0) {
    return request;
  }

  const lastIndex = systemPrompt.length - 1;
  const blocks: LlmSystemPromptBlock[] = systemPrompt.map((block, index) =>
    index === lastIndex ? { ...block, cacheControl } : block,
  );

  return { ...request, systemPrompt: blocks };
}

export function addCacheBreakpointOnLastTool(
  request: LlmRequest,
  cacheControl: LlmCacheControl,
): LlmRequest {
  const tools = request.tools;

  if (tools === undefined || tools.length === 0) {
    return request;
  }

  const lastIndex = tools.length - 1;
  const updatedTools = tools.map((tool, index) =>
    index === lastIndex ? withToolCacheControl(tool, cacheControl) : tool,
  );

  return { ...request, tools: updatedTools };
}

// Marks the last block on the request's last message with a cache breakpoint.
// Blocks whose `type` is not in `CACHEABLE_BLOCK_TYPES` (including server tool
// result blocks) are passed through unchanged even if the matcher selects
// them, because Anthropic does not accept `cache_control` on those shapes.
export function addCacheBreakpointOnLastBlock(
  request: LlmRequest,
  cacheControl: LlmCacheControl,
  matcher: (block: LlmContentBlock) => boolean = (block) => CACHEABLE_BLOCK_TYPES.has(block.type),
): LlmRequest {
  if (request.messages.length === 0) {
    return request;
  }

  const lastMessageIndex = request.messages.length - 1;
  const lastMessage = request.messages[lastMessageIndex];

  if (lastMessage === undefined || typeof lastMessage.content === 'string') {
    return request;
  }

  const blocks = lastMessage.content;
  let targetIndex = -1;

  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i];

    if (block !== undefined && matcher(block)) {
      targetIndex = i;
      break;
    }
  }

  if (targetIndex === -1) {
    return request;
  }

  const updatedBlocks = blocks.map((block, index) =>
    index === targetIndex ? withCacheControl(block, cacheControl) : block,
  );
  const updatedMessages = request.messages.map((message, index) =>
    index === lastMessageIndex ? { ...message, content: updatedBlocks } : message,
  );

  return { ...request, messages: updatedMessages };
}
