import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  loadCodeExecUpload,
  loadFilesApiUpload,
  loadImageFile,
  loadPdfFile,
  loadTextFile,
  sanitizeRemoteFilename,
} from '../../src/files/safety.js';

const PNG_HEADER = Buffer.from('89504e470d0a1a0a0000000d', 'hex');
const JPEG_HEADER = Buffer.from('ffd8ffe00010', 'hex');

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'caps-lab-test-'));
});

afterAll(async () => {
  await fsp.rm(tmpDir, { force: true, recursive: true });
});

async function writeTempFile(filename: string, buffer: Buffer | string): Promise<string> {
  const filePath = path.join(tmpDir, filename);
  await fsp.writeFile(filePath, buffer);

  return filePath;
}

describe('loadImageFile', () => {
  it('reads a PNG with a valid header', async () => {
    const filePath = await writeTempFile('sample.png', PNG_HEADER);
    const { base64, mediaType } = await loadImageFile(filePath);
    expect(mediaType).toBe('image/png');
    expect(base64).toBe(PNG_HEADER.toString('base64'));
  });

  it('rejects a mismatched extension/header', async () => {
    const filePath = await writeTempFile('mismatch.png', JPEG_HEADER);
    await expect(loadImageFile(filePath)).rejects.toThrow(/MIME mismatch/);
  });

  it('rejects unsupported extensions', async () => {
    const filePath = await writeTempFile('weird.bmp', PNG_HEADER);
    await expect(loadImageFile(filePath)).rejects.toThrow(/Unsupported image extension/);
  });

  it('rejects missing files', async () => {
    await expect(loadImageFile(path.join(tmpDir, 'missing.png'))).rejects.toThrow(/not found/);
  });
});

describe('loadPdfFile', () => {
  it('reads a PDF with %PDF- header', async () => {
    const filePath = await writeTempFile('doc.pdf', Buffer.from('%PDF-1.4\n%test'));
    const { base64 } = await loadPdfFile(filePath);
    expect(base64.length).toBeGreaterThan(0);
  });

  it('rejects files without %PDF- header', async () => {
    const filePath = await writeTempFile('not.pdf', Buffer.from('Hello, world'));
    await expect(loadPdfFile(filePath)).rejects.toThrow(/%PDF-/);
  });
});

describe('loadTextFile', () => {
  it('reads UTF-8 text', async () => {
    const filePath = await writeTempFile('a.txt', 'Earth is the third planet.');
    const { content } = await loadTextFile(filePath);
    expect(content).toBe('Earth is the third planet.');
  });
});

describe('loadFilesApiUpload', () => {
  it('validates a supported upload extension and returns metadata without reading content', async () => {
    const filePath = await writeTempFile('data.csv', 'a,b\n1,2');
    const validated = await loadFilesApiUpload(filePath);

    expect(validated).toEqual({
      absolutePath: filePath,
      mimeType: 'text/csv',
      sizeBytes: 7,
    });
  });

  it('rejects unsupported upload extensions', async () => {
    const filePath = await writeTempFile('data.exe', 'nope');

    await expect(loadFilesApiUpload(filePath)).rejects.toThrow(/Unsupported file extension/);
  });
});

describe('loadCodeExecUpload', () => {
  it('validates a supported code execution upload without returning file contents', async () => {
    const filePath = await writeTempFile('data.csv', 'a,b\n1,2');
    const validated = await loadCodeExecUpload(filePath);

    expect(validated).toEqual({
      absolutePath: filePath,
      mimeType: 'text/csv',
      sizeBytes: 7,
    });
    expect('buffer' in validated).toBe(false);
  });
});

describe('sanitizeRemoteFilename', () => {
  it('rejects paths with separators', () => {
    expect(() => sanitizeRemoteFilename('a/b.txt')).toThrow(/path separator/);
  });

  it('rejects hidden filenames', () => {
    expect(() => sanitizeRemoteFilename('.secret')).toThrow(/hidden/);
  });

  it('normalizes unusual characters', () => {
    expect(sanitizeRemoteFilename('weird file name?.csv')).toBe('weird_file_name_.csv');
  });
});
