export class DocumentNotFoundError extends Error {
  readonly code = 'document_not_found';

  constructor(public readonly docId: string) {
    super(`Document not found: ${docId}`);
    this.name = 'DocumentNotFoundError';
  }
}

export class DocumentEditError extends Error {
  readonly code: 'empty_old_str' | 'old_str_not_found' | 'old_str_not_unique';

  constructor(code: 'empty_old_str' | 'old_str_not_found' | 'old_str_not_unique', message: string) {
    super(message);
    this.code = code;
    this.name = 'DocumentEditError';
  }
}

export interface EditDocumentParams {
  readonly docId: string;
  readonly newStr: string;
  readonly oldStr: string;
}

export interface EditDocumentResult {
  readonly docId: string;
  readonly replacements: number;
}

export interface DocumentStore {
  editDocument(params: EditDocumentParams): EditDocumentResult;
  listDocumentIds(): readonly string[];
  readDocument(docId: string): string;
}

function countOccurrences(text: string, needle: string): number {
  if (needle === '') {
    return 0;
  }

  let count = 0;
  let index = text.indexOf(needle);

  while (index !== -1) {
    count += 1;
    index = text.indexOf(needle, index + needle.length);
  }

  return count;
}

export function createDocumentStore(seed: Readonly<Record<string, string>>): DocumentStore {
  const documents = new Map<string, string>(Object.entries(seed));

  return {
    editDocument({ docId, newStr, oldStr }) {
      const content = documents.get(docId);

      if (content === undefined) {
        throw new DocumentNotFoundError(docId);
      }

      if (oldStr === '') {
        throw new DocumentEditError(
          'empty_old_str',
          'old_str must not be empty. Provide the exact text to replace.',
        );
      }

      const matches = countOccurrences(content, oldStr);

      if (matches === 0) {
        throw new DocumentEditError(
          'old_str_not_found',
          `old_str was not found in document "${docId}". Provide an exact substring.`,
        );
      }

      if (matches > 1) {
        throw new DocumentEditError(
          'old_str_not_unique',
          `old_str matched ${String(matches)} times in document "${docId}". Provide a longer substring that uniquely identifies the location.`,
        );
      }

      const updated = content.replace(oldStr, newStr);
      documents.set(docId, updated);

      return { docId, replacements: 1 };
    },
    listDocumentIds() {
      return [...documents.keys()].toSorted();
    },
    readDocument(docId) {
      const content = documents.get(docId);

      if (content === undefined) {
        throw new DocumentNotFoundError(docId);
      }

      return content;
    },
  };
}
