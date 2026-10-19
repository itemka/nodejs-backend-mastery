import { z } from 'zod';

export const DRIVE_API_URL = 'https://www.googleapis.com/drive/v3';
/** Media uploads; the resumable session URLs Drive returns also start with this. */
export const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
export const DRIVE_FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
export const ZIP_MIME_TYPE = 'application/zip';

/** Drive IDs are interpolated into URLs and queries, so they are limited to ID characters. */
export const driveIdSchema = z.string().regex(/^[\w-]{1,200}$/);

export const driveFileSchema = z.object({
  appProperties: z.record(z.string(), z.string()).optional(),
  capabilities: z.object({ canAddChildren: z.boolean().optional() }).optional(),
  createdTime: z.iso.datetime({ offset: true }).optional(),
  id: driveIdSchema,
  mimeType: z.string().optional(),
  name: z.string().optional(),
  parents: z.array(driveIdSchema).optional(),
  /** Hex, compared in lower case. */
  sha256Checksum: z
    .string()
    .regex(/^[\dA-Fa-f]{64}$/)
    .transform((value) => value.toLowerCase())
    .optional(),
  /** Drive returns int64 values as decimal strings. */
  size: z
    .string()
    .regex(/^\d{1,15}$/)
    .transform(Number)
    .optional(),
  trashed: z.boolean().optional(),
});

export type DriveFile = z.infer<typeof driveFileSchema>;

export const driveFileListSchema = z.object({
  files: z.array(driveFileSchema).default([]),
  nextPageToken: z.string().optional(),
});

export type DriveFileList = z.infer<typeof driveFileListSchema>;

/** Escapes a string literal for a Drive `q` expression. */
export function driveQueryString(value: string): string {
  const escaped = value.replaceAll(/['\\]/g, String.raw`\$&`);

  return `'${escaped}'`;
}
