import { describe, expect, it } from 'vitest';

import type { PageObservation } from '../../../src/adapters/notion/session-gate.js';
import { classifyPage, workspaceNamePattern } from '../../../src/adapters/notion/session-gate.js';

const loading: PageObservation = {
  appShell: false,
  challenge: false,
  path: '/p/Dashboard-39a92d1ef41b81d09ff7fdbfabab9943',
  title: 'Notion',
};

describe('classifyPage', () => {
  it.each<[string, Partial<PageObservation>, ReturnType<typeof classifyPage>]>([
    ['the app shell', { appShell: true }, 'authenticated'],
    ['nothing rendered yet', {}, 'loading'],
    ['the login page', { path: '/login' }, 'login'],
    ['a login sub-page', { path: '/login/email' }, 'login'],
    ['the login page, with a shell-like element', { appShell: true, path: '/login' }, 'login'],
    ['a page that only starts with "login"', { path: '/loginfo' }, 'loading'],
    ['a challenge widget', { challenge: true }, 'challenge'],
    ['a challenge over the app shell', { appShell: true, challenge: true }, 'challenge'],
    ["Cloudflare's interstitial", { title: 'Just a moment...' }, 'challenge'],
    ['a verification title', { title: 'Verify you are human' }, 'challenge'],
    ['a block page', { title: 'Attention Required! | Cloudflare' }, 'challenge'],
  ])('%s → %s', (_case, overrides, expected) => {
    expect(classifyPage({ ...loading, ...overrides })).toBe(expected);
  });
});

describe('workspaceNamePattern', () => {
  it("treats ' and ’ as the same character", () => {
    const pattern = workspaceNamePattern("Test User's Notion");

    expect(pattern.test("Test User's Notion")).toBe(true);
    expect(pattern.test('Test User’s Notion')).toBe(true);
    expect(workspaceNamePattern('Test User’s Notion').test("Test User's Notion")).toBe(true);
  });

  it.each(["T Test User's Notion", "📘 Test User's Notion", "👍🏽 Test User's Notion"])(
    'accepts one avatar character before the name: %s',
    (accessibleName) => {
      expect(workspaceNamePattern("Test User's Notion").test(accessibleName)).toBe(true);
    },
  );

  it.each([
    "Test User's Notion Archive",
    "Test User's Notions",
    "Old Test User's Notion",
    "TT Test User's Notion",
    "Someone Else's Notion",
  ])('rejects another workspace: %s', (accessibleName) => {
    expect(workspaceNamePattern("Test User's Notion").test(accessibleName)).toBe(false);
  });

  it('treats a run of spaces as one', () => {
    expect(workspaceNamePattern(" Test  User's Notion ").test("Test User's Notion")).toBe(true);
  });

  it('matches every other character literally', () => {
    const pattern = workspaceNamePattern('A.B (C) [D] $1+2? {x}|y^z\\ "q" `t` >> é');

    expect(pattern.test('A.B (C) [D] $1+2? {x}|y^z\\ "q" `t` >> é')).toBe(true);
    expect(pattern.test('AxB (C) [D] $1+2? {x}|y^z\\ "q" `t` >> é')).toBe(false);
  });

  it("keeps quotes and > out of the pattern's source, which Playwright's selector chains need", () => {
    const { source } = workspaceNamePattern('Test User\'s "Notion" `x` >> y');

    expect(source).not.toMatch(/['"`>]/);
  });
});
