import {
  CfWorkerJsonSchemaValidator,
  fromJsonSchema,
  McpServer,
  ResourceTemplate,
} from '@modelcontextprotocol/server';

import {
  DocumentEditError,
  DocumentNotFoundError,
  type DocumentStore,
} from '../documents/document-store.js';

export const SERVER_NAME = 'document-mcp-server';
export const SERVER_VERSION = '0.1.0';

export const DOCUMENTS_LIST_URI = 'docs://documents';
const DOCUMENT_RESOURCE_PREFIX = 'docs://documents/';
const DOCUMENT_TEMPLATE = 'docs://documents/{doc_id}';

interface ReadDocArgs {
  readonly doc_id: string;
}

interface EditDocArgs {
  readonly doc_id: string;
  readonly new_str: string;
  readonly old_str: string;
}

interface FormatPromptArgs {
  readonly doc_id: string;
}

const validator = new CfWorkerJsonSchemaValidator({ draft: '2020-12' });

const readDocInputSchema = fromJsonSchema<ReadDocArgs>(
  {
    additionalProperties: false,
    properties: {
      doc_id: { description: 'Identifier of the document to read.', minLength: 1, type: 'string' },
    },
    required: ['doc_id'],
    type: 'object',
  },
  validator,
);

const readDocOutputSchema = fromJsonSchema<{ content: string; doc_id: string }>(
  {
    additionalProperties: false,
    properties: {
      content: { type: 'string' },
      doc_id: { type: 'string' },
    },
    required: ['content', 'doc_id'],
    type: 'object',
  },
  validator,
);

const editDocInputSchema = fromJsonSchema<EditDocArgs>(
  {
    additionalProperties: false,
    properties: {
      doc_id: { description: 'Identifier of the document to edit.', minLength: 1, type: 'string' },
      new_str: { description: 'Replacement text. May be empty to delete old_str.', type: 'string' },
      old_str: {
        description: 'Exact substring to replace. Must appear once.',
        minLength: 1,
        type: 'string',
      },
    },
    required: ['doc_id', 'old_str', 'new_str'],
    type: 'object',
  },
  validator,
);

const editDocOutputSchema = fromJsonSchema<{
  doc_id: string;
  replacements: number;
  updated: boolean;
}>(
  {
    additionalProperties: false,
    properties: {
      doc_id: { type: 'string' },
      replacements: { minimum: 0, type: 'integer' },
      updated: { type: 'boolean' },
    },
    required: ['doc_id', 'replacements', 'updated'],
    type: 'object',
  },
  validator,
);

const formatPromptArgsSchema = fromJsonSchema<FormatPromptArgs>(
  {
    additionalProperties: false,
    properties: {
      doc_id: { description: 'Document id to format.', minLength: 1, type: 'string' },
    },
    required: ['doc_id'],
    type: 'object',
  },
  validator,
);

function isErrorWithMessage(error: unknown): error is { message: string } {
  return typeof error === 'object' && error !== null && 'message' in error;
}

function errorMessage(error: unknown): string {
  return isErrorWithMessage(error) ? error.message : String(error);
}

export function createDocumentMcpServer(store: DocumentStore): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    'read_doc_contents',
    {
      description: 'Read the full text contents of a document by its id.',
      inputSchema: readDocInputSchema,
      outputSchema: readDocOutputSchema,
      title: 'Read document contents',
    },
    (args) => {
      const { doc_id } = args;

      try {
        const content = store.readDocument(doc_id);
        const structured = { content, doc_id };

        return {
          content: [{ text: content, type: 'text' as const }],
          structuredContent: structured,
        };
      } catch (error) {
        if (error instanceof DocumentNotFoundError) {
          return {
            content: [{ text: `Document "${doc_id}" was not found.`, type: 'text' as const }],
            isError: true,
          };
        }

        return {
          content: [
            { text: `Failed to read document: ${errorMessage(error)}`, type: 'text' as const },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'edit_document',
    {
      description:
        'Edit a document by replacing an exact substring. old_str must match exactly once.',
      inputSchema: editDocInputSchema,
      outputSchema: editDocOutputSchema,
      title: 'Edit document',
    },
    (args) => {
      const { doc_id, new_str, old_str } = args;

      try {
        const result = store.editDocument({ docId: doc_id, newStr: new_str, oldStr: old_str });
        const structured = {
          doc_id: result.docId,
          replacements: result.replacements,
          updated: result.replacements > 0,
        };

        return {
          content: [
            {
              text: `Updated "${result.docId}" (${String(result.replacements)} replacement).`,
              type: 'text' as const,
            },
          ],
          structuredContent: structured,
        };
      } catch (error) {
        if (error instanceof DocumentNotFoundError || error instanceof DocumentEditError) {
          return {
            content: [{ text: error.message, type: 'text' as const }],
            isError: true,
          };
        }

        return {
          content: [
            { text: `Failed to edit document: ${errorMessage(error)}`, type: 'text' as const },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerResource(
    'documents-list',
    DOCUMENTS_LIST_URI,
    {
      description: 'JSON array of all document ids known to the server.',
      mimeType: 'application/json',
      title: 'All documents',
    },
    (uri) => ({
      contents: [
        {
          mimeType: 'application/json',
          text: JSON.stringify({ documents: store.listDocumentIds() }),
          uri: uri.href,
        },
      ],
    }),
  );

  server.registerResource(
    'document',
    new ResourceTemplate(DOCUMENT_TEMPLATE, {
      list: () => ({
        resources: store.listDocumentIds().map((docId) => ({
          mimeType: 'text/plain',
          name: docId,
          title: docId,
          uri: `${DOCUMENT_RESOURCE_PREFIX}${docId}`,
        })),
      }),
    }),
    {
      description: 'Plain-text contents of an individual document.',
      mimeType: 'text/plain',
      title: 'Document content',
    },
    (uri, variables) => {
      const docIdRaw = variables.doc_id;
      const docId = Array.isArray(docIdRaw) ? docIdRaw[0] : docIdRaw;

      if (typeof docId !== 'string' || docId === '') {
        throw new Error('doc_id is required in the resource URI.');
      }

      return {
        contents: [
          {
            mimeType: 'text/plain',
            text: store.readDocument(docId),
            uri: uri.href,
          },
        ],
      };
    },
  );

  server.registerPrompt(
    'format',
    {
      argsSchema: formatPromptArgsSchema,
      description:
        'Read the document and improve formatting using edit_document when changes are warranted.',
      title: 'Format document',
    },
    (args) => {
      const { doc_id } = args;

      return {
        messages: [
          {
            content: {
              text: [
                `You are formatting the document "${doc_id}".`,
                '',
                '1. Call the read_doc_contents tool to retrieve the current text.',
                '2. Identify formatting issues: inconsistent headings, broken markdown, trailing whitespace, or unwrapped paragraphs.',
                '3. When changes are warranted, call edit_document with a unique old_str and a corrected new_str. Make one targeted edit at a time.',
                '4. When no further changes are needed, summarize what you changed and why in plain text.',
              ].join('\n'),
              type: 'text' as const,
            },
            role: 'user' as const,
          },
        ],
      };
    },
  );

  return server;
}
