import { describe, expect, it } from 'vitest';

import {
  renderFinalAnswer,
  renderSources,
  renderThinking,
  renderUsage,
} from '../../src/render/output.js';

describe('renderThinking', () => {
  it('shows thinking and redacted thinking when enabled', () => {
    const output = renderThinking(
      [
        { signature: 'sig', thinking: 'step 1...', type: 'thinking' },
        { data: 'enc', type: 'redacted_thinking' },
      ],
      { show: true },
    );
    expect(output).toContain('Thinking');
    expect(output).toContain('step 1...');
    expect(output).toContain('redacted by safety filter');
  });

  it('returns nothing when show is false', () => {
    const output = renderThinking([{ signature: 'sig', thinking: 'step 1...', type: 'thinking' }], {
      show: false,
    });
    expect(output).toBe('');
  });
});

describe('renderSources', () => {
  it('formats web search sources', () => {
    const output = renderSources([
      {
        citedText: 'Cited excerpt that is short.',
        kind: 'web_search',
        title: 'Site',
        url: 'https://example.com/article',
      },
    ]);
    expect(output).toContain('Site — https://example.com/article');
    expect(output).toContain('Cited excerpt');
  });

  it('formats page citations', () => {
    const output = renderSources([
      {
        citedText: 'Earth orbits the sun.',
        documentIndex: 0,
        documentTitle: 'earth.pdf',
        kind: 'document',
        location: { endPageNumber: 2, startPageNumber: 1, type: 'page_location' },
      },
    ]);
    expect(output).toContain('earth.pdf (pages 1-2)');
  });

  it('formats char citations', () => {
    const output = renderSources([
      {
        citedText: 'third planet',
        documentIndex: 0,
        documentTitle: 'earth.txt',
        kind: 'document',
        location: { endCharIndex: 30, startCharIndex: 9, type: 'char_location' },
      },
    ]);
    expect(output).toContain('earth.txt (chars 9-30)');
  });
});

describe('renderUsage', () => {
  it('includes cache metrics when present', () => {
    const output = renderUsage({
      cacheCreation: { ephemeral1hInputTokens: 0, ephemeral5mInputTokens: 1000 },
      cacheCreationInputTokens: 1000,
      cacheReadInputTokens: 200,
      inputTokens: 50,
      outputTokens: 10,
    });
    expect(output).toContain('cache_creation=1000');
    expect(output).toContain('cache_read=200');
    expect(output).toContain('creation_5m=1000');
  });
});

describe('renderFinalAnswer', () => {
  it('shows a placeholder when text is empty', () => {
    const output = renderFinalAnswer('');
    expect(output).toContain('(no text returned)');
  });

  it('shows the answer text', () => {
    const output = renderFinalAnswer('Hello world');
    expect(output).toContain('Hello world');
  });
});
