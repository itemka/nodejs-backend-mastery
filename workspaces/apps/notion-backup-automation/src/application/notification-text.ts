import type { ExportShrink, ExportSize } from '../domain/export-size.js';
import type {
  AttentionNotification,
  FailureNotification,
  LateEmailNotification,
  LoginService,
  LoginWarningNotification,
  SuccessNotification,
} from './ports.js';

/*
 * One-line, plain-text summaries of notifications: the console log line and the text of the
 * job event. They hold only the notification's allowlisted fields, never a URL or a token.
 */

const UNIT_STEP = 1000;
const byteUnits = ['KB', 'MB', 'GB', 'TB'] as const;

/** Decimal units with one decimal: 1,104 bytes → `1.1 KB`, 8,907,221 → `8.9 MB`. */
export function formatBytes(bytes: number): string {
  if (bytes < UNIT_STEP) {
    return `${bytes} B`;
  }

  let value = bytes / UNIT_STEP;
  let unit = 0;

  // Rounded first, so 999,960 bytes reads `1.0 MB`, not `1000.0 KB`.
  while (Math.round(value * 10) / 10 >= UNIT_STEP && unit < byteUnits.length - 1) {
    value /= UNIT_STEP;
    unit += 1;
  }

  return `${value.toFixed(1)} ${byteUnits[unit] ?? 'TB'}`;
}

/** `45 s`, `23 m 10 s`, `5 h 2 m`, `2 d 3 h`. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return `${seconds} s`;
  if (minutes < 60) return `${minutes} m ${seconds % 60} s`;
  if (hours < 24) return `${hours} h ${minutes % 60} m`;

  return `${days} d ${hours % 24} h`;
}

/** `198 files (8.9 MB)`, or only the size when the file count is unknown. */
export function describeSize({ entryCount, sizeBytes }: ExportSize): string {
  if (entryCount === undefined) {
    return formatBytes(sizeBytes);
  }

  return `${entryCount} ${entryCount === 1 ? 'file' : 'files'} (${formatBytes(sizeBytes)})`;
}

/** The comparison a shrunk backup's message shows: `3 files (1.1 KB); last backup (2026-10) had …`. */
export function describeShrink(
  backup: ExportSize & { readonly shrink?: ExportShrink | undefined },
): string | undefined {
  const { shrink } = backup;

  if (shrink === undefined) {
    return undefined;
  }

  const previous = describeSize({
    ...(shrink.previousEntryCount === undefined ? {} : { entryCount: shrink.previousEntryCount }),
    sizeBytes: shrink.previousSizeBytes,
  });

  return `${describeSize(backup)}; last backup (${shrink.previousJobId}) had ${previous}`;
}

export const serviceNames: Readonly<Record<LoginService, string>> = {
  drive: 'Google Drive folder',
  google: 'Google',
  notion: 'Notion',
};

export function successText(notification: SuccessNotification): string {
  const location = `${notification.fileName} in ${notification.folder}`;
  const shrink = describeShrink(notification);

  if (shrink !== undefined) {
    return `⚠️ Notion backup stored, but much smaller than the last one · job ${notification.jobId} · ${shrink} · ${location}`;
  }

  return `✅ Notion backup completed · job ${notification.jobId} · ${describeSize(notification)} · ${location} · ${formatDuration(notification.durationMs)}`;
}

export function failureText(notification: FailureNotification): string {
  return `❌ Notion backup failed · job ${notification.jobId} · stage ${notification.stage} · ${notification.code}: ${notification.reason}`;
}

export function attentionText(notification: AttentionNotification): string {
  return `⚠️ Notion backup requires attention · job ${notification.jobId} · stage ${notification.stage} · ${notification.code}: ${notification.howToFix}`;
}

export function lateEmailText(notification: LateEmailNotification): string {
  return `⏳ Notion export email is late · job ${notification.jobId} · attempt ${notification.exportAttempt} · no email after ${formatDuration(notification.waitedMs)}`;
}

export function loginWarningText(notification: LoginWarningNotification): string {
  const service = serviceNames[notification.service];

  switch (notification.kind) {
    case 'expiring': {
      const date = notification.expiresAt?.slice(0, 10) ?? 'soon';
      const days = notification.daysLeft === undefined ? '' : ` (${notification.daysLeft} days)`;

      return `🔑 ${service} login expires on ${date}${days} · ${notification.howToFix}`;
    }

    case 'lost': {
      return `🔑 ${service} access is gone · ${notification.howToFix}`;
    }

    case 'renewed': {
      return notification.expiresAt === undefined
        ? `🔑 ${service} access renewed`
        : `🔑 ${service} login renewed, valid until ${notification.expiresAt.slice(0, 10)}`;
    }
  }
}
