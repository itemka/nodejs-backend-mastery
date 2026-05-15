import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';

import { createAnthropicFilesApi, DEFAULT_FILES_API_BETA } from '../../src/anthropic/files-api.js';

function makeMetadata(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    created_at: '2026-05-01T00:00:00Z',
    downloadable: true,
    filename: 'streaming.csv',
    id: 'file_abc',
    mime_type: 'text/csv',
    size_bytes: 1024,
    type: 'file',
    ...overrides,
  };
}

describe('createAnthropicFilesApi', () => {
  it('uploads with the files-api beta header', async () => {
    const upload = vi.fn().mockResolvedValue(makeMetadata());
    const client = { beta: { files: { upload } } } as unknown as Anthropic;
    const api = createAnthropicFilesApi(client);

    const fileLike = { name: 'streaming.csv' } as unknown as Parameters<
      typeof api.upload
    >[0]['file'];
    const result = await api.upload({ file: fileLike });

    expect(upload).toHaveBeenCalledWith({ betas: [DEFAULT_FILES_API_BETA], file: fileLike });
    expect(result).toEqual({
      createdAt: '2026-05-01T00:00:00Z',
      downloadable: true,
      filename: 'streaming.csv',
      id: 'file_abc',
      mimeType: 'text/csv',
      sizeBytes: 1024,
    });
  });

  it('retrieves metadata', async () => {
    const retrieveMetadata = vi.fn().mockResolvedValue(makeMetadata());
    const client = { beta: { files: { retrieveMetadata } } } as unknown as Anthropic;
    const api = createAnthropicFilesApi(client);

    const result = await api.metadata('file_abc');
    expect(retrieveMetadata).toHaveBeenCalledWith('file_abc', { betas: [DEFAULT_FILES_API_BETA] });
    expect(result.filename).toBe('streaming.csv');
  });

  it('lists files', async () => {
    const list = vi.fn().mockResolvedValue({
      data: [makeMetadata(), makeMetadata({ id: 'file_def' })],
      hasNextPage: () => false,
    });
    const client = { beta: { files: { list } } } as unknown as Anthropic;
    const api = createAnthropicFilesApi(client);

    const page = await api.list({ limit: 2 });
    expect(list).toHaveBeenCalledWith({ betas: [DEFAULT_FILES_API_BETA], limit: 2 });
    expect(page.files).toHaveLength(2);
    expect(page.hasMore).toBe(false);
  });

  it('deletes files', async () => {
    const deleteFn = vi.fn().mockResolvedValue({ id: 'file_abc', type: 'file_deleted' });
    const client = { beta: { files: { delete: deleteFn } } } as unknown as Anthropic;
    const api = createAnthropicFilesApi(client);

    const result = await api.delete('file_abc');
    expect(deleteFn).toHaveBeenCalledWith('file_abc', { betas: [DEFAULT_FILES_API_BETA] });
    expect(result).toEqual({ id: 'file_abc' });
  });

  it('exposes download response readers', async () => {
    const arrayBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(8));
    const blob = vi.fn().mockResolvedValue({} as Blob);
    const headers = new Headers({ 'content-type': 'application/octet-stream' });
    const responseLike = { arrayBuffer, blob, body: null, headers };
    const download = vi.fn().mockResolvedValue(responseLike);
    const client = { beta: { files: { download } } } as unknown as Anthropic;
    const api = createAnthropicFilesApi(client);

    const result = await api.download('file_abc');
    expect(download).toHaveBeenCalledWith('file_abc', { betas: [DEFAULT_FILES_API_BETA] });
    expect(result.contentType).toBe('application/octet-stream');
    await result.arrayBuffer();
    expect(arrayBuffer).toHaveBeenCalled();
  });
});
