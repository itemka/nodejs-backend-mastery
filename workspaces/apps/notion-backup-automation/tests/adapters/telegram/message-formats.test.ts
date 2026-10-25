import { describe, expect, it } from 'vitest';

import type { MessageFormatOptions } from '../../../src/adapters/telegram/message-formats.js';
import {
  attentionMessage,
  callbackData,
  driveFileUrl,
  escapeHtml,
  failureMessage,
  loginWarningMessage,
  successMessage,
  testMessage,
} from '../../../src/adapters/telegram/message-formats.js';
import type { TelegramMessage } from '../../../src/adapters/telegram/telegram-client.js';
import {
  MAX_CALLBACK_DATA_BYTES,
  MAX_MESSAGE_LENGTH,
} from '../../../src/adapters/telegram/telegram-client.js';
import type {
  AttentionNotification,
  FailureNotification,
  SuccessNotification,
} from '../../../src/application/ports.js';
import { redactString } from '../../../src/shared/redact.js';
import { fakeBotToken } from '../../support/fake-telegram.js';

const options: MessageFormatOptions = { appEnv: 'prod', timeZone: 'Europe/Warsaw' };

const success: SuccessNotification = {
  driveFileId: '1AbCdEfGhIjKlMnOpQrStUvWxYz',
  durationMs: (23 * 60 + 10) * 1000,
  entryCount: 198,
  fileName: 'notion-workspace-2026-10-01.zip',
  folder: '2026',
  jobId: '2026-10',
  period: '2026-10',
  sizeBytes: 8_907_221,
};

const shrunk: SuccessNotification = {
  ...success,
  entryCount: 3,
  fileName: 'notion-workspace-2026-11-01.zip',
  jobId: '2026-11',
  period: '2026-11',
  shrink: { previousEntryCount: 198, previousJobId: '2026-10', previousSizeBytes: 8_907_221 },
  sizeBytes: 1104,
};

const attention: AttentionNotification = {
  code: 'NOTION_SESSION_EXPIRED',
  howToFix: 'Run auth:notion, then run backup_retry.',
  jobId: '2026-10',
  period: '2026-10',
  reason: 'The saved Notion session is no longer signed in.',
  recentEvents: [
    { at: '2026-10-01T04:00:00.000Z', text: 'Job created (scheduled)' },
    { at: '2026-10-01T04:01:00.000Z', text: 'CREATED → TRIGGERING_EXPORT' },
    {
      at: '2026-10-01T04:02:00.000Z',
      text: 'TRIGGERING_EXPORT → NEEDS_ATTENTION (NOTION_SESSION_EXPIRED)',
    },
  ],
  retryFromScratch: true,
  stage: 'NOTION_TRIGGER',
};

const failure: FailureNotification = {
  code: 'JOB_LIFETIME_EXCEEDED',
  jobId: '2026-10',
  period: '2026-10',
  reason: 'The job exceeded its maximum lifetime.',
  stage: 'EMAIL_WAIT',
};

function buttonsOf(message: TelegramMessage): string[] {
  return (message.buttons ?? [])
    .flat()
    .map((button) => `${button.text}=${'url' in button ? button.url : button.callbackData}`);
}

const urlPattern = /https?:\/\/[^\s"'<>]+/g;

/** The allowlist rule, as for the MCP views: no URL but the Drive file link, and nothing `redact` would change. */
function expectChatSafe(message: TelegramMessage): void {
  const everything = [message.html, ...buttonsOf(message)].join('\n');

  for (const url of everything.match(urlPattern) ?? []) {
    expect(url).toMatch(/^https:\/\/drive\.google\.com\/file\/d\/[\w-]+\/view$/);
  }

  expect(redactString(message.html)).toBe(message.html);

  for (const button of (message.buttons ?? []).flat()) {
    if ('callbackData' in button) {
      expect(Buffer.byteLength(button.callbackData)).toBeLessThanOrEqual(MAX_CALLBACK_DATA_BYTES);
    }
  }
}

describe('successMessage', () => {
  it('reports the period, size, file count, file name, folder and duration, with a Drive button', () => {
    const message = successMessage(success, options);

    expect(message.html).toBe(
      [
        '✅ <b>Notion backup stored</b>',
        'Size: 198 files (8.9 MB)',
        'Period: 2026-10',
        'File: notion-workspace-2026-10-01.zip',
        'Folder: 2026',
        'Took: 23 m 10 s',
      ].join('\n'),
    );
    expect(buttonsOf(message)).toEqual([`Open in Drive=${driveFileUrl(success.driveFileId)}`]);
    expectChatSafe(message);
  });

  it('turns ✅ into ⚠️ when the backup shrank, with both counts and sizes and a Status button', () => {
    const message = successMessage(shrunk, options);

    expect(message.html).toContain('⚠️ <b>Backup stored, but much smaller than the last one</b>');
    expect(message.html).toContain(
      '3 files (1.1 KB); last backup (2026-10) had 198 files (8.9 MB). Check what the export covers.',
    );
    expect(message.html).not.toContain('✅');
    expect(buttonsOf(message)).toEqual([
      `Open in Drive=${driveFileUrl(success.driveFileId)}`,
      'Status=s:2026-11',
    ]);
    expectChatSafe(message);
  });

  it('shows only the size when the file count is unknown (a backup adopted from Drive)', () => {
    const { entryCount: _count, ...adopted } = success;

    expect(successMessage(adopted, options).html).toContain('Size: 8.9 MB\n');
  });

  it('names the environment unless it is prod', () => {
    expect(successMessage(success, { ...options, appEnv: 'dev' }).html).toMatch(
      /^🧪 <i>dev<\/i> · ✅/,
    );
  });
});

describe('attentionMessage', () => {
  it('shows the stage, code, reason, fix and recent events in the backup time zone', () => {
    const message = attentionMessage(
      { ...attention, supervisorSummary: 'The session expired; sign in again.' },
      options,
    );

    expect(message.html).toBe(
      [
        '⚠️ <b>Notion backup needs attention</b>',
        'Job 2026-10 · stage NOTION_TRIGGER',
        '<b>NOTION_SESSION_EXPIRED</b>: The saved Notion session is no longer signed in.',
        '<b>Fix:</b> Run auth:notion, then run backup_retry.',
        '<b>Supervisor:</b> The session expired; sign in again.',
        '',
        '<b>Recent events</b>',
        '<code>10-01 06:00</code> Job created (scheduled)',
        '<code>10-01 06:01</code> CREATED → TRIGGERING_EXPORT',
        '<code>10-01 06:02</code> TRIGGERING_EXPORT → NEEDS_ATTENTION (NOTION_SESSION_EXPIRED)',
      ].join('\n'),
    );
    expectChatSafe(message);
  });

  it('offers Status, Retry, Retry from scratch, Cancel and, for a login code, Fix login', () => {
    expect(buttonsOf(attentionMessage(attention, options))).toEqual([
      'Status=s:2026-10',
      'Retry=r:2026-10',
      'Retry from scratch=f:2026-10',
      'Cancel=x:2026-10',
      'Fix login=l:notion',
    ]);
    expect(
      buttonsOf(attentionMessage({ ...attention, code: 'GOOGLE_AUTH_REQUIRED' }, options)),
    ).toContain('Fix login=l:google');
  });

  it('hides Retry from scratch at the attempt cap, and Fix login for other codes', () => {
    const buttons = buttonsOf(
      attentionMessage(
        { ...attention, code: 'NOTION_UI_CHANGED', retryFromScratch: false },
        options,
      ),
    );

    expect(buttons).toEqual(['Status=s:2026-10', 'Retry=r:2026-10', 'Cancel=x:2026-10']);
  });

  it('escapes HTML in every value', () => {
    const message = attentionMessage(
      {
        ...attention,
        recentEvents: [
          { at: '2026-10-01T04:00:00.000Z', text: '<script>alert("x")</script> & co' },
        ],
        supervisorSummary: '<b>bold</b> claim',
      },
      options,
    );

    expect(message.html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; co');
    expect(message.html).toContain('<b>Supervisor:</b> &lt;b&gt;bold&lt;/b&gt; claim');
  });

  it('never passes a URL, a token or a cookie on, even from poisoned events and summaries', () => {
    const poison = [
      'https://file.notion.com/f/t/abc/Export.zip?table=user_export&expirationTimestamp=1',
      'https://mg.mail.notion.com/c/eJxTrackingToken',
      'Authorization: Bearer abc.DEF-123',
      `bot ${fakeBotToken}`,
      'token_v2=v02%3Auser; file_token=abc',
      'https://example.com/page?api_key=secret',
    ];
    const message = attentionMessage(
      {
        ...attention,
        recentEvents: poison.map((text) => ({ at: '2026-10-01T04:00:00.000Z', text })),
        supervisorSummary: poison.join(' '),
      },
      options,
    );

    expectChatSafe(message);
    expect(message.html).not.toContain(fakeBotToken);
    expect(message.html).not.toContain('user_export');
    expect(message.html).not.toContain('api_key=secret');
  });

  it('keeps the newest 10 events and stays within Telegram’s length limit', () => {
    const recentEvents = Array.from({ length: 30 }, (_, index) => ({
      at: '2026-10-01T04:00:00.000Z',
      text: `event ${index} ${'x'.repeat(390)}`,
    }));
    const message = attentionMessage(
      { ...attention, recentEvents, supervisorSummary: 'y'.repeat(2000) },
      options,
    );

    expect(message.html.length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH);
    expect(message.html).toContain('<b>NOTION_SESSION_EXPIRED</b>');
    expect(message.html).toContain('event 29');
    expect(message.html).not.toContain('event 19 ');
  });
});

describe('failureMessage', () => {
  it('reports the stage, code and reason, with a Status button', () => {
    const message = failureMessage(failure, options);

    expect(message.html).toBe(
      [
        '❌ <b>Notion backup failed</b>',
        'Job 2026-10 · stage EMAIL_WAIT',
        '<b>JOB_LIFETIME_EXCEEDED</b>: The job exceeded its maximum lifetime.',
      ].join('\n'),
    );
    expect(buttonsOf(message)).toEqual(['Status=s:2026-10']);
    expectChatSafe(message);
  });
});

describe('loginWarningMessage', () => {
  it('warns before the Notion login expires, with a Fix login button', () => {
    const message = loginWarningMessage(
      {
        daysLeft: 30,
        expiresAt: '2027-10-22T23:47:00.000Z',
        howToFix: 'Run auth:notion on the Mac.',
        kind: 'expiring',
        service: 'notion',
      },
      options,
    );

    expect(message.html).toBe(
      '🔑 <b>Notion login expires on 2027-10-22 (30 days)</b>\n<b>Fix:</b> Run auth:notion on the Mac.',
    );
    expect(buttonsOf(message)).toEqual(['Fix login=l:notion']);
  });

  it('says when access is gone', () => {
    const message = loginWarningMessage(
      { howToFix: 'Run auth:google.', kind: 'lost', service: 'google' },
      options,
    );

    expect(message.html).toContain('🔑 <b>Google access is gone</b>');
    expect(buttonsOf(message)).toEqual(['Fix login=l:google']);
  });

  it('confirms a renewal without buttons', () => {
    expect(
      loginWarningMessage(
        { expiresAt: '2028-10-22T00:00:00.000Z', howToFix: '', kind: 'renewed', service: 'notion' },
        options,
      ),
    ).toEqual({ html: '🔑 <b>Notion login renewed, valid until 2028-10-22</b>' });
  });
});

describe('testMessage', () => {
  it('names the environment and carries a Status button for the active or latest job', () => {
    const message = testMessage({ appEnv: 'dev' });

    expect(message.html).toContain('(APP_ENV dev)');
    expect(buttonsOf(message)).toEqual(['Status=s:']);
    expectChatSafe(message);
  });
});

describe('helpers', () => {
  it('escapes &, <, > and "', () => {
    expect(escapeHtml('a & <b> "c"')).toBe('a &amp; &lt;b&gt; &quot;c&quot;');
  });

  it('refuses callback_data over 64 bytes', () => {
    expect(callbackData('status', '2026-10-r99999')).toBe('s:2026-10-r99999');
    expect(() => callbackData('status', 'x'.repeat(63))).toThrow(RangeError);
  });
});
