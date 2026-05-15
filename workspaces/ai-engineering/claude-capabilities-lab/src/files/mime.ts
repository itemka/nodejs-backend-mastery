import path from 'node:path';

export type SupportedImageMimeType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

const IMAGE_EXT_TO_MIME: Record<string, SupportedImageMimeType> = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

const CODE_EXEC_UPLOAD_MIME: Record<string, string> = {
  '.csv': 'text/csv',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.txt': 'text/plain',
  '.webp': 'image/webp',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export const CODE_EXEC_UPLOAD_EXTENSIONS: readonly string[] = Object.keys(CODE_EXEC_UPLOAD_MIME);

export function detectImageMimeFromExtension(filePath: string): SupportedImageMimeType | undefined {
  const ext = path.extname(filePath).toLowerCase();

  return IMAGE_EXT_TO_MIME[ext];
}

export function detectCodeExecUploadMime(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase();

  return CODE_EXEC_UPLOAD_MIME[ext];
}

export function isAllowedCodeExecUploadExtension(filePath: string): boolean {
  return detectCodeExecUploadMime(filePath) !== undefined;
}

const JPEG_MAGIC = Buffer.from('ffd8ff', 'hex');
const PNG_MAGIC = Buffer.from('89504e470d0a1a0a', 'hex');
const GIF87_MAGIC = Buffer.from('GIF87a');
const GIF89_MAGIC = Buffer.from('GIF89a');
const WEBP_RIFF = Buffer.from('RIFF');
const WEBP_FOURCC = Buffer.from('WEBP');

function bufferStartsWith(buffer: Buffer, prefix: Buffer): boolean {
  if (buffer.length < prefix.length) {
    return false;
  }

  return buffer.subarray(0, prefix.length).equals(prefix);
}

export function detectImageMimeFromHeader(buffer: Buffer): SupportedImageMimeType | undefined {
  if (bufferStartsWith(buffer, JPEG_MAGIC)) {
    return 'image/jpeg';
  }

  if (bufferStartsWith(buffer, PNG_MAGIC)) {
    return 'image/png';
  }

  if (bufferStartsWith(buffer, GIF87_MAGIC) || bufferStartsWith(buffer, GIF89_MAGIC)) {
    return 'image/gif';
  }

  if (
    bufferStartsWith(buffer, WEBP_RIFF) &&
    buffer.length >= 12 &&
    buffer.subarray(8, 12).equals(WEBP_FOURCC)
  ) {
    return 'image/webp';
  }

  return undefined;
}

const PDF_MAGIC = Buffer.from('%PDF-');

export function looksLikePdf(buffer: Buffer): boolean {
  return bufferStartsWith(buffer, PDF_MAGIC);
}
