import { z } from 'zod';

export const DRIVE_API_URL = 'https://www.googleapis.com/drive/v3';
export const DRIVE_FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

/** Drive IDs are interpolated into URLs and queries, so they are limited to ID characters. */
export const driveIdSchema = z.string().regex(/^[\w-]{1,200}$/);

export const driveFileSchema = z.object({
  appProperties: z.record(z.string(), z.string()).optional(),
  capabilities: z.object({ canAddChildren: z.boolean().optional() }).optional(),
  id: driveIdSchema,
  mimeType: z.string().optional(),
  name: z.string().optional(),
  trashed: z.boolean().optional(),
});

export type DriveFile = z.infer<typeof driveFileSchema>;

export const driveFileListSchema = z.object({
  files: z.array(driveFileSchema),
});
