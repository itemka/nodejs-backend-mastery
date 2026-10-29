import { describe, expect, it } from 'vitest';

import { landmarksFromAriaSnapshot } from '../../../src/adapters/notion/notion-settings-page.js';

describe('landmarksFromAriaSnapshot', () => {
  it('keeps role:name pairs, and leaves out text nodes and pattern names', () => {
    const snapshot = [
      '- dialog "Settings":',
      '  - heading "Workspace" [level=2]',
      '  - tab "General" [selected]',
      '  - text: Workspace content Export your whole workspace',
      '  - button "Export"',
      String.raw`  - button "Say \"hi\""`,
      '  - link /Learn about .*/',
      '  - paragraph: Members',
    ].join('\n');

    expect(landmarksFromAriaSnapshot(snapshot)).toEqual([
      'dialog:Settings',
      'heading:Workspace',
      'tab:General',
      'button:Export',
      'button:Say "hi"',
    ]);
  });
});
