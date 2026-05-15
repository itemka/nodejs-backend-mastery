import type Anthropic from '@anthropic-ai/sdk';

export const DEFAULT_FILES_API_BETA = 'files-api-2025-04-14';

export interface FileMetadata {
  readonly id: string;
  readonly createdAt: string;
  readonly downloadable?: boolean;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

export interface FileListPage {
  readonly files: readonly FileMetadata[];
  readonly hasMore: boolean;
}

export interface FileDownloadResult {
  readonly arrayBuffer: () => Promise<ArrayBuffer>;
  readonly blob: () => Promise<Blob>;
  readonly contentType: string | null;
  readonly stream: () => ReadableStream<Uint8Array> | null;
}

export interface AnthropicFilesApi {
  delete(fileId: string): Promise<{ readonly id: string }>;
  download(fileId: string): Promise<FileDownloadResult>;
  list(params?: { readonly limit?: number; readonly scopeId?: string }): Promise<FileListPage>;
  metadata(fileId: string): Promise<FileMetadata>;
  upload(params: {
    readonly file: Parameters<Anthropic['beta']['files']['upload']>[0]['file'];
  }): Promise<FileMetadata>;
}

interface CreateFilesApiOptions {
  readonly beta?: string;
}

function toFileMetadata(
  raw: Awaited<ReturnType<Anthropic['beta']['files']['retrieveMetadata']>>,
): FileMetadata {
  return {
    createdAt: raw.created_at,
    filename: raw.filename,
    id: raw.id,
    mimeType: raw.mime_type,
    sizeBytes: raw.size_bytes,
    ...(raw.downloadable === undefined ? {} : { downloadable: raw.downloadable }),
  };
}

export function createAnthropicFilesApi(
  client: Anthropic,
  options: CreateFilesApiOptions = {},
): AnthropicFilesApi {
  const beta = options.beta ?? DEFAULT_FILES_API_BETA;

  return {
    async delete(fileId) {
      const result = await client.beta.files.delete(fileId, { betas: [beta] });

      return { id: result.id };
    },

    async download(fileId) {
      const response = await client.beta.files.download(fileId, { betas: [beta] });

      return {
        arrayBuffer: () => response.arrayBuffer(),
        blob: () => response.blob(),
        contentType: response.headers.get('content-type'),
        stream: () => response.body,
      };
    },

    async list(params = {}) {
      const page = await client.beta.files.list({
        betas: [beta],
        ...(params.limit === undefined ? {} : { limit: params.limit }),
        ...(params.scopeId === undefined ? {} : { scope_id: params.scopeId }),
      });

      return {
        files: page.data.map((file) => toFileMetadata(file)),
        hasMore: page.hasNextPage(),
      };
    },

    async metadata(fileId) {
      const raw = await client.beta.files.retrieveMetadata(fileId, { betas: [beta] });

      return toFileMetadata(raw);
    },

    async upload(params) {
      const raw = await client.beta.files.upload({ betas: [beta], file: params.file });

      return toFileMetadata(raw);
    },
  };
}
