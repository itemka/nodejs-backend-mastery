import type { McpStdioClient } from '../client/mcp-client.js';

const DOCUMENT_RESOURCE_PREFIX = 'docs://documents/';
const DOCUMENTS_LIST_URI = 'docs://documents';

export interface DocumentSnippet {
  readonly content: string;
  readonly docId: string;
}

export interface DocumentContextResult {
  readonly snippets: readonly DocumentSnippet[];
  readonly unknown: readonly string[];
}

function normalizeMentionToken(value: string): string {
  return value.replaceAll(/\.+$/g, '');
}

export function extractDocumentMentions(text: string): readonly string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const match of text.matchAll(/@([\w./-]+)/g)) {
    const value = match[1] === undefined ? undefined : normalizeMentionToken(match[1]);

    if (value !== undefined && value !== '' && !seen.has(value)) {
      seen.add(value);
      ordered.push(value);
    }
  }

  return ordered;
}

interface DocumentsListPayload {
  documents?: unknown;
}

function parseDocumentList(text: string): readonly string[] {
  let payload: DocumentsListPayload;

  try {
    payload = JSON.parse(text) as DocumentsListPayload;
  } catch {
    return [];
  }

  if (!Array.isArray(payload.documents)) {
    return [];
  }

  return payload.documents.filter((id): id is string => typeof id === 'string');
}

export async function listKnownDocumentIds(client: McpStdioClient): Promise<readonly string[]> {
  const result = await client.readResource(DOCUMENTS_LIST_URI);

  for (const content of result.contents) {
    if ('text' in content && typeof content.text === 'string') {
      return parseDocumentList(content.text);
    }
  }

  return [];
}

export async function resolveMentions(
  client: McpStdioClient,
  text: string,
): Promise<DocumentContextResult> {
  const mentions = extractDocumentMentions(text);

  if (mentions.length === 0) {
    return { snippets: [], unknown: [] };
  }

  const known = new Set(await listKnownDocumentIds(client));
  const snippets: DocumentSnippet[] = [];
  const unknown: string[] = [];

  for (const docId of mentions) {
    if (!known.has(docId)) {
      unknown.push(docId);
      continue;
    }

    const result = await client.readResource(`${DOCUMENT_RESOURCE_PREFIX}${docId}`);
    const textContent = result.contents.find(
      (content): content is { text: string; uri: string; mimeType?: string } =>
        'text' in content && typeof content.text === 'string',
    );

    if (textContent !== undefined) {
      snippets.push({ content: textContent.text, docId });
    }
  }

  return { snippets, unknown };
}

export function buildUserTextWithContext(
  userText: string,
  snippets: readonly DocumentSnippet[],
): string {
  if (snippets.length === 0) {
    return userText;
  }

  const blocks = snippets.map(
    (snippet) => `<document id="${snippet.docId}">\n${snippet.content}\n</document>`,
  );

  return ['Referenced documents:', ...blocks, '', 'User message:', userText].join('\n');
}
