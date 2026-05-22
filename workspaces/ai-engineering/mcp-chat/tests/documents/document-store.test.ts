import { describe, expect, it } from 'vitest';

import {
  createDocumentStore,
  DocumentEditError,
  DocumentNotFoundError,
} from '../../src/documents/document-store.js';

const seed = {
  'a.md': 'Hello world',
  'b.md': 'one two three\none two three',
} as const;

describe('document store', () => {
  it('lists document ids sorted', () => {
    const store = createDocumentStore(seed);

    expect(store.listDocumentIds()).toEqual(['a.md', 'b.md']);
  });

  it('reads existing documents', () => {
    const store = createDocumentStore(seed);

    expect(store.readDocument('a.md')).toBe('Hello world');
  });

  it('throws DocumentNotFoundError for missing documents', () => {
    const store = createDocumentStore(seed);

    expect(() => store.readDocument('missing.md')).toThrow(DocumentNotFoundError);
  });

  it('edits a unique substring', () => {
    const store = createDocumentStore(seed);
    const result = store.editDocument({ docId: 'a.md', newStr: 'planet', oldStr: 'world' });

    expect(result).toEqual({ docId: 'a.md', replacements: 1 });
    expect(store.readDocument('a.md')).toBe('Hello planet');
  });

  it('fails when old_str is empty', () => {
    const store = createDocumentStore(seed);

    expect(() => store.editDocument({ docId: 'a.md', newStr: 'x', oldStr: '' })).toThrow(
      DocumentEditError,
    );
  });

  it('fails when old_str is missing', () => {
    const store = createDocumentStore(seed);

    expect(() => store.editDocument({ docId: 'a.md', newStr: 'x', oldStr: 'nope' })).toThrow(
      DocumentEditError,
    );
  });

  it('fails when old_str matches multiple times', () => {
    const store = createDocumentStore(seed);

    expect(() =>
      store.editDocument({ docId: 'b.md', newStr: 'X', oldStr: 'one two three' }),
    ).toThrow(/multiple times|matched 2 times/i);
  });

  it('fails for missing document on edit', () => {
    const store = createDocumentStore(seed);

    expect(() => store.editDocument({ docId: 'missing.md', newStr: 'x', oldStr: 'y' })).toThrow(
      DocumentNotFoundError,
    );
  });
});
