import * as ui from '@workspaces/cli-output';
import type {
  LlmContentBlock,
  LlmResponse,
  LlmSource,
  LlmUsage,
} from '@workspaces/packages/llm-client';

const MAX_EXCERPT = 120;

function truncate(text: string): string {
  const normalized = text.replaceAll(/\s+/g, ' ').trim();

  if (normalized.length <= MAX_EXCERPT) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_EXCERPT - 3)}...`;
}

export function renderFinalAnswer(text: string): string {
  return [
    '',
    ui.heading('=== Answer ==='),
    text.trim() === '' ? ui.muted('(no text returned)') : text,
  ].join('\n');
}

export function renderThinking(
  content: readonly LlmContentBlock[],
  options: { readonly show: boolean },
): string {
  if (!options.show) {
    return '';
  }

  const lines: string[] = [];

  for (const block of content) {
    if (block.type === 'thinking') {
      lines.push(ui.muted('--- thinking ---'), block.thinking.trim());
    } else if (block.type === 'redacted_thinking') {
      lines.push(ui.muted('--- thinking (redacted by safety filter) ---'));
    }
  }

  if (lines.length === 0) {
    return '';
  }

  return ['', ui.heading('=== Thinking ==='), ...lines].join('\n');
}

export function renderSources(sources: readonly LlmSource[] | undefined): string {
  if (sources === undefined || sources.length === 0) {
    return '';
  }

  const lines: string[] = ['', ui.heading('=== Citations ===')];

  for (const [index, source] of sources.entries()) {
    if (source.kind === 'web_search') {
      lines.push(
        `  ${index + 1}. ${source.title ?? source.url} — ${source.url}`,
        `     "${truncate(source.citedText)}"`,
      );

      continue;
    }

    const titleLine = source.documentTitle ?? `document #${source.documentIndex}`;
    const location = source.location;

    if (location.type === 'page_location') {
      lines.push(
        `  ${index + 1}. ${titleLine} (pages ${location.startPageNumber}-${location.endPageNumber})`,
      );
    } else if (location.type === 'char_location') {
      lines.push(
        `  ${index + 1}. ${titleLine} (chars ${location.startCharIndex}-${location.endCharIndex})`,
      );
    } else {
      lines.push(
        `  ${index + 1}. ${titleLine} (blocks ${location.startBlockIndex}-${location.endBlockIndex})`,
      );
    }

    if (source.fileId !== undefined && source.fileId !== null) {
      lines.push(ui.muted(`     file_id=${source.fileId}`));
    }

    lines.push(`     "${truncate(source.citedText)}"`);
  }

  return lines.join('\n');
}

export function renderUsage(usage: LlmUsage | undefined): string {
  if (usage === undefined) {
    return '';
  }

  const parts: string[] = [`input=${usage.inputTokens}`, `output=${usage.outputTokens}`];

  if (usage.cacheCreationInputTokens !== undefined) {
    parts.push(`cache_creation=${usage.cacheCreationInputTokens}`);
  }

  if (usage.cacheReadInputTokens !== undefined) {
    parts.push(`cache_read=${usage.cacheReadInputTokens}`);
  }

  if (usage.cacheCreation !== undefined) {
    parts.push(
      `creation_5m=${usage.cacheCreation.ephemeral5mInputTokens}`,
      `creation_1h=${usage.cacheCreation.ephemeral1hInputTokens}`,
    );
  }

  if (usage.serverToolUse !== undefined) {
    if (usage.serverToolUse.codeExecutionRequests !== undefined) {
      parts.push(`code_exec=${usage.serverToolUse.codeExecutionRequests}`);
    }

    if (usage.serverToolUse.webSearchRequests !== undefined) {
      parts.push(`web_search=${usage.serverToolUse.webSearchRequests}`);
    }

    if (usage.serverToolUse.webFetchRequests !== undefined) {
      parts.push(`web_fetch=${usage.serverToolUse.webFetchRequests}`);
    }
  }

  return ['', ui.heading('=== Usage ==='), ui.muted(parts.join(', '))].join('\n');
}

export function renderResponseDebug(response: LlmResponse): string {
  return ['', ui.heading('=== Raw response ==='), JSON.stringify(response.raw, undefined, 2)].join(
    '\n',
  );
}
