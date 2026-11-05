import { describe, expect, it } from 'vitest';

import { GmailApi } from '../../../src/adapters/gmail/gmail-api.js';
import { GmailLoginCodeFinder } from '../../../src/adapters/gmail/gmail-login-code-finder.js';
import type { GmailMessage } from '../../../src/adapters/gmail/gmail-schemas.js';
import { GoogleApiClient } from '../../../src/adapters/google/google-api-client.js';
import { NotionLoginError } from '../../../src/application/notion-login-error.js';
import { createLogger } from '../../../src/shared/logger.js';
import { FakeGoogle, googleError } from '../../support/fake-google.js';
import {
  loadEmailFixture,
  messageWith,
  toGmailMessage,
  withHeader,
} from '../../support/gmail-fixtures.js';

const MESSAGES_PATH = 'gmail.googleapis.com/gmail/v1/users/me/messages';

const login = loadEmailFixture('notion-login-code');
const receivedAt = Number(login.internalDate);
/** The code was requested 6 s before the email arrived (S7: 4.9–6.6 s). */
const requestedAt = new Date(receivedAt - 6000);

/**
 * Gmail, where `inbox(poll)` is what a search returns on that poll (1-based): the email arrives
 * when the test says so. Sleeps are counted, never waited.
 */
function setup(inbox: (poll: number) => readonly GmailMessage[]) {
  let polls = 0;
  let current: readonly GmailMessage[] = [];
  const context = { paged: false };
  const fetched: string[] = [];
  const google = new FakeGoogle()
    .on('GET', MESSAGES_PATH, () => {
      polls += 1;
      current = inbox(polls);

      return Response.json({
        messages: current.map(({ id }) => ({ id, threadId: id })),
        ...(context.paged ? { nextPageToken: 'page-2' } : {}),
      });
    })
    .on('GET', `${MESSAGES_PATH}/*`, ({ url }) => {
      const message = current.find(({ id }) => url.pathname.endsWith(`/${id}`));

      fetched.push(url.pathname.split('/').at(-1) ?? '');

      return message === undefined ? googleError(404, 'notFound') : Response.json(message);
    })
    .on('GET', 'gmail.googleapis.com/gmail/v1/users/me/profile', () =>
      Response.json({ emailAddress: 'User@Example.com' }),
    );
  const lines: string[] = [];
  const sleeps: number[] = [];
  const finder = new GmailLoginCodeFinder({
    gmail: new GmailApi(
      new GoogleApiClient({
        fetch: google.fetch,
        service: 'gmail',
        sleep: () => Promise.resolve(),
        tokenProvider: { getAccessToken: () => Promise.resolve('fake-access-token') },
      }),
    ),
    logger: createLogger({ level: 'debug', sink: (_level, line) => lines.push(line) }),
    sleep: (ms) => {
      sleeps.push(ms);

      return Promise.resolve();
    },
  });

  return {
    fetched,
    finder,
    lines,
    get paged() {
      return context.paged;
    },
    set paged(value: boolean) {
      context.paged = value;
    },
    polls: () => polls,
    sleeps,
  };
}

/**
 * A finder over Gmail whose handlers the test writes, with a fetch that, like a hung connection,
 * ignores the abort: only the finder can end the wait. `signals` are what each request got.
 */
function handSetup(handlers: {
  readonly get?: () => Promise<Response> | Response;
  readonly list: () => Promise<Response> | Response;
}) {
  const signals: (AbortSignal | null | undefined)[] = [];
  const google = new FakeGoogle()
    .on('GET', MESSAGES_PATH, handlers.list)
    .on('GET', `${MESSAGES_PATH}/*`, handlers.get ?? (() => googleError(404, 'notFound')))
    .on('GET', 'gmail.googleapis.com/gmail/v1/users/me/profile', () =>
      Response.json({ emailAddress: 'user@example.com' }),
    );
  const finder = new GmailLoginCodeFinder({
    gmail: new GmailApi(
      new GoogleApiClient({
        fetch: (input, init) => {
          signals.push(init?.signal);

          return google.fetch(input, init);
        },
        service: 'gmail',
        sleep: () => Promise.resolve(),
        tokenProvider: { getAccessToken: () => Promise.resolve('fake-access-token') },
      }),
    ),
    logger: createLogger({
      sink: () => {
        // The finder's logs are not under test here.
      },
    }),
    sleep: () => Promise.resolve(),
  });

  return { finder, signals };
}

describe('GmailLoginCodeFinder', () => {
  it('reports the Gmail profile’s address, lowercased', async () => {
    await expect(setup(() => []).finder.mailbox()).resolves.toBe('user@example.com');
  });

  it('polls every 5 s until the trusted email arrives, and never logs the code', async () => {
    const { finder, lines, polls, sleeps } = setup((poll) =>
      poll < 3 ? [] : [toGmailMessage(login)],
    );
    const code = await finder.waitForCode({ requestedAt });

    expect(code.reveal()).toBe('Qx7mKp');
    expect(polls()).toBe(3);
    expect(sleeps).toEqual([5000, 5000]);
    expect(lines.join('\n')).toContain('gmail.login_email.found');
    expect(lines.join('\n')).not.toContain('Qx7mKp');
  });

  it('skips the "new device" notice, and does not fetch it again', async () => {
    const notice = toGmailMessage({
      ...withHeader(login, 'Subject', 'A new device logged into your account'),
      id: '19a1c3ca00000002',
      internalDate: String(receivedAt + 7000),
    });
    const { fetched, finder } = setup((poll) =>
      poll === 1 ? [notice] : [notice, toGmailMessage(login)],
    );

    await expect(finder.waitForCode({ requestedAt }).then((c) => c.reveal())).resolves.toBe(
      'Qx7mKp',
    );
    expect(fetched.filter((id) => id === notice.id)).toHaveLength(1);
  });

  it('types nothing when someone else’s code arrived too: email_ambiguous', async () => {
    const other = messageWith(login, {
      html: '<pre>Zz9Yy8</pre>',
      id: '19a1c3ca00000001',
      internalDate: String(receivedAt - 2000),
      text: 'Zz9Yy8',
    });
    const { finder, lines } = setup(() => [other, toGmailMessage(login)]);
    const failure = finder.waitForCode({ requestedAt });

    await expect(failure).rejects.toMatchObject({ failure: 'email_ambiguous' });
    expect(lines.join('\n')).not.toMatch(/Qx7mKp|Zz9Yy8/);
  });

  it('fails email_ambiguous when the hits fill more than one search page', async () => {
    const google = setup(() => []);

    google.paged = true;

    await expect(google.finder.waitForCode({ requestedAt })).rejects.toMatchObject({
      failure: 'email_ambiguous',
    });
  });

  it('ignores an email from an earlier request', async () => {
    const stale = messageWith(login, { internalDate: String(requestedAt.getTime() - 31_000) });
    const { finder, polls } = setup(() => [stale]);

    await expect(finder.waitForCode({ requestedAt })).rejects.toMatchObject({
      failure: 'email_missing',
    });
    expect(polls()).toBe(12);
  });

  it('gives up after 60 s of polls with email_missing', async () => {
    const { finder, lines, sleeps } = setup(() => []);
    const failure = finder.waitForCode({ requestedAt });

    await expect(failure).rejects.toBeInstanceOf(NotionLoginError);
    await expect(failure).rejects.toMatchObject({ failure: 'email_missing' });
    expect(sleeps).toHaveLength(11);
    expect(lines.join('\n')).toContain('gmail.login_email.missing');
  });

  it('fails code_unrecognized when the trusted email holds no single code', async () => {
    const changed = messageWith(login, { html: '<p>Login to Notion</p>', text: 'Use the link.' });

    await expect(setup(() => [changed]).finder.waitForCode({ requestedAt })).rejects.toMatchObject({
      failure: 'code_unrecognized',
    });
  });

  it('ends a Gmail request still in flight when the budget runs out', async () => {
    const controller = new AbortController();
    const listed = Promise.withResolvers<void>();
    const { finder, signals } = handSetup({
      list: () => {
        listed.resolve();

        return new Promise<Response>(() => {
          // Never answers, whatever the signal says.
        });
      },
    });
    const failure = finder.waitForCode({ requestedAt, signal: controller.signal });

    await listed.promise;
    controller.abort(new Error('budget'));

    await expect(failure).rejects.toThrow('budget');
    // The abort also reached the request itself, so a real fetch is cancelled, not left running.
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((signal) => signal?.aborted === true)).toBe(true);
  });

  it('returns no code once the budget ran out while the email was read', async () => {
    const controller = new AbortController();
    const message = toGmailMessage(login);
    const { finder } = handSetup({
      get: () => {
        controller.abort(new Error('budget'));

        return Response.json(message);
      },
      list: () => Response.json({ messages: [{ id: message.id, threadId: message.id }] }),
    });

    await expect(finder.waitForCode({ requestedAt, signal: controller.signal })).rejects.toThrow(
      'budget',
    );
  });

  it('stops at once when the login’s budget is spent', async () => {
    const controller = new AbortController();

    controller.abort(new Error('budget'));

    await expect(
      setup(() => []).finder.waitForCode({ requestedAt, signal: controller.signal }),
    ).rejects.toThrow('budget');
  });
});
