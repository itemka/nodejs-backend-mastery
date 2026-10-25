import {
  describeShrink,
  describeSize,
  formatDuration,
  serviceNames,
} from '../../application/notification-text.js';
import type {
  AttentionNotification,
  FailureNotification,
  LoginService,
  LoginWarningNotification,
  NotificationEventLine,
  SuccessNotification,
} from '../../application/ports.js';
import type { AppEnv } from '../../config/env.js';
import type { ErrorCode } from '../../domain/error-catalog.js';
import { redactString } from '../../shared/redact.js';
import type { TelegramButton, TelegramMessage } from './telegram-client.js';
import { MAX_CALLBACK_DATA_BYTES, MAX_MESSAGE_LENGTH } from './telegram-client.js';

/*
 * The Telegram messages, built from the notifications' allowlisted fields only. Every value is
 * redacted and HTML-escaped, so no URL but the Drive file link, and no token, reaches the chat.
 */

/** The first letter of a button's `callback_data`; the webhook maps each to an application method. */
export const buttonActions = {
  cancel: 'x',
  fixLogin: 'l',
  retry: 'r',
  retryFromScratch: 'f',
  status: 's',
} as const;

export type ButtonAction = keyof typeof buttonActions;

export interface MessageFormatOptions {
  /** Messages from another environment than `prod` carry its name, so a dev run never reads as a real backup. */
  readonly appEnv: AppEnv;
  /** The time zone of the event times. */
  readonly timeZone: string;
}

const MAX_EVENT_LINES = 10;
const MAX_EVENT_TEXT = 160;
const MAX_SUMMARY_TEXT = 400;

/** The codes a login fixes, and the login that fixes them. */
const loginServiceOf: Readonly<Partial<Record<ErrorCode, LoginService>>> = {
  GOOGLE_AUTH_REQUIRED: 'google',
  NOTION_INTERACTIVE_CHALLENGE: 'notion',
  NOTION_SESSION_EXPIRED: 'notion',
  NOTION_WRONG_WORKSPACE: 'notion',
};

/** Escapes the characters Telegram's HTML parse mode reserves. */
export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * `<action>:<target>`: `s:2026-10`, `l:notion`. An empty target means the active or latest
 * job, as `/status` does.
 */
export function callbackData(action: ButtonAction, target = ''): string {
  const data = `${buttonActions[action]}:${target}`;

  if (Buffer.byteLength(data) > MAX_CALLBACK_DATA_BYTES) {
    throw new RangeError(`callback_data is limited to ${MAX_CALLBACK_DATA_BYTES} bytes`);
  }

  return data;
}

/** The one URL a message may hold. */
export function driveFileUrl(driveFileId: string): string {
  return `https://drive.google.com/file/d/${encodeURIComponent(driveFileId)}/view`;
}

export function successMessage(
  notification: SuccessNotification,
  options: MessageFormatOptions,
): TelegramMessage {
  const openInDrive: TelegramButton = {
    text: 'Open in Drive',
    url: driveFileUrl(notification.driveFileId),
  };
  const details = [
    `Period: ${safe(notification.period)}`,
    `File: ${safe(notification.fileName)}`,
    `Folder: ${safe(notification.folder)}`,
  ];
  const shrink = describeShrink(notification);

  if (shrink !== undefined) {
    return {
      buttons: [[openInDrive, statusButton(notification.jobId)]],
      html: lines(
        `${envTag(options)}⚠️ <b>Backup stored, but much smaller than the last one</b>`,
        `${safe(shrink)}. Check what the export covers.`,
        ...details,
      ),
    };
  }

  return {
    buttons: [[openInDrive]],
    html: lines(
      `${envTag(options)}✅ <b>Notion backup stored</b>`,
      `Size: ${safe(describeSize(notification))}`,
      ...details,
      `Took: ${formatDuration(notification.durationMs)}`,
    ),
  };
}

export function failureMessage(
  notification: FailureNotification,
  options: MessageFormatOptions,
): TelegramMessage {
  return {
    buttons: [[statusButton(notification.jobId)]],
    html: lines(
      `${envTag(options)}❌ <b>Notion backup failed</b>`,
      `Job ${safe(notification.jobId)} · stage ${notification.stage}`,
      `<b>${notification.code}</b>: ${safe(notification.reason)}`,
    ),
  };
}

export function attentionMessage(
  notification: AttentionNotification,
  options: MessageFormatOptions,
): TelegramMessage {
  const head = [
    `${envTag(options)}⚠️ <b>Notion backup needs attention</b>`,
    `Job ${safe(notification.jobId)} · stage ${notification.stage}`,
    `<b>${notification.code}</b>: ${safe(notification.reason)}`,
    `<b>Fix:</b> ${safe(notification.howToFix)}`,
  ];

  if (notification.supervisorSummary !== undefined) {
    head.push(`<b>Supervisor:</b> ${safe(clip(notification.supervisorSummary, MAX_SUMMARY_TEXT))}`);
  }

  let events = notification.recentEvents
    .slice(-MAX_EVENT_LINES)
    .map((event) => eventLine(event, options.timeZone));
  let html = withEvents(head, events);

  // The oldest events give way first, so the code and the fix always fit.
  while (html.length > MAX_MESSAGE_LENGTH && events.length > 0) {
    events = events.slice(1);
    html = withEvents(head, events);
  }

  const login = loginServiceOf[notification.code];
  const buttons: TelegramButton[][] = [
    [statusButton(notification.jobId), button('Retry', 'retry', notification.jobId)],
    [
      ...(notification.retryFromScratch
        ? [button('Retry from scratch', 'retryFromScratch', notification.jobId)]
        : []),
      button('Cancel', 'cancel', notification.jobId),
    ],
  ];

  if (login !== undefined) {
    buttons.push([button('Fix login', 'fixLogin', login)]);
  }

  return { buttons, html };
}

export function loginWarningMessage(
  notification: LoginWarningNotification,
  options: MessageFormatOptions,
): TelegramMessage {
  const service = serviceNames[notification.service];
  const fixLogin = [[button('Fix login', 'fixLogin', notification.service)]];

  switch (notification.kind) {
    case 'expiring': {
      const days = notification.daysLeft === undefined ? '' : ` (${notification.daysLeft} days)`;

      return {
        buttons: fixLogin,
        html: lines(
          `${envTag(options)}🔑 <b>${service} login expires on ${dateOf(notification.expiresAt)}${days}</b>`,
          `<b>Fix:</b> ${safe(notification.howToFix)}`,
        ),
      };
    }

    case 'lost': {
      return {
        buttons: fixLogin,
        html: lines(
          `${envTag(options)}🔑 <b>${service} access is gone</b>`,
          `<b>Fix:</b> ${safe(notification.howToFix)}`,
        ),
      };
    }

    case 'renewed': {
      const headline =
        notification.expiresAt === undefined
          ? `${service} access renewed`
          : `${service} login renewed, valid until ${dateOf(notification.expiresAt)}`;

      return { html: `${envTag(options)}🔑 <b>${headline}</b>` };
    }
  }
}

/** `telegram:setup --test`: proves delivery, with a Status button for the webhook to answer. */
export function testMessage(options: Pick<MessageFormatOptions, 'appEnv'>): TelegramMessage {
  return {
    buttons: [[statusButton()]],
    html: lines(
      `🧪 <b>Test message from the Notion backup agent</b> (APP_ENV ${options.appEnv})`,
      'Backup reports arrive here. The buttons answer once the webhook is set.',
    ),
  };
}

/** The day of an ISO timestamp, `2027-10-22`. */
function dateOf(iso: string | undefined): string {
  return safe(iso?.slice(0, 10) ?? 'soon');
}

function statusButton(jobId?: string): TelegramButton {
  return button('Status', 'status', jobId);
}

function button(text: string, action: ButtonAction, target?: string): TelegramButton {
  return { callbackData: callbackData(action, target), text };
}

function envTag({ appEnv }: MessageFormatOptions): string {
  return appEnv === 'prod' ? '' : `🧪 <i>${appEnv}</i> · `;
}

function eventLine(event: NotificationEventLine, timeZone: string): string {
  return `<code>${localTime(event.at, timeZone)}</code> ${safe(clip(event.text, MAX_EVENT_TEXT))}`;
}

function withEvents(head: readonly string[], events: readonly string[]): string {
  return events.length === 0
    ? lines(...head)
    : lines(...head, '', '<b>Recent events</b>', ...events);
}

const timeFormatters = new Map<string, Intl.DateTimeFormat>();

/** `10-01 06:05`, in the backup time zone. */
function localTime(iso: string, timeZone: string): string {
  let formatter = timeFormatters.get(timeZone);

  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
      minute: '2-digit',
      month: '2-digit',
      timeZone,
    });
    timeFormatters.set(timeZone, formatter);
  }

  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return '--';
  }

  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  ) as Partial<Record<Intl.DateTimeFormatPartTypes, string>>;

  return `${parts.month ?? ''}-${parts.day ?? ''} ${parts.hour ?? ''}:${parts.minute ?? ''}`;
}

const urlPattern = /\bhttps?:\/\/[^\s"'<>`]+/gi;

/**
 * Text from outside this file: no URL at all (the Drive link is a button, never text), no
 * token-shaped string, then escaped.
 */
function safe(text: string): string {
  return escapeHtml(redactString(text.replaceAll(urlPattern, '[link]')));
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function lines(...parts: readonly string[]): string {
  return parts.join('\n');
}
