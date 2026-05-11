import { describe, expect, it } from 'vitest';

import { chunkBySections } from '../../src/chunking/chunk-by-sections.js';

describe('chunkBySections', () => {
  it('preserves section titles from ## headings', () => {
    const text = ['## First Section', 'first body', '', '## Second Section', 'second body'].join(
      '\n',
    );
    const chunks = chunkBySections(text);

    expect(chunks).toEqual([
      {
        content: '## First Section\n\nfirst body',
        index: 0,
        sectionTitle: 'First Section',
      },
      {
        content: '## Second Section\n\nsecond body',
        index: 1,
        sectionTitle: 'Second Section',
      },
    ]);
  });

  it('captures preamble before any heading as its own section', () => {
    const text = ['intro line', '', '## Section', 'body'].join('\n');

    expect(chunkBySections(text)).toEqual([
      { content: 'intro line', index: 0 },
      { content: '## Section\n\nbody', index: 1, sectionTitle: 'Section' },
    ]);
  });

  it('drops empty body sections without titles', () => {
    expect(chunkBySections('   \n\n   ')).toEqual([]);
  });
});
