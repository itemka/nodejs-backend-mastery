import { describe, expect, it } from 'vitest';

import { validateCacheTargetArgs } from '../../src/scenarios/cache.js';

describe('validateCacheTargetArgs', () => {
  it('rejects document cache target without a document path', () => {
    expect(() => validateCacheTargetArgs('document', {})).toThrow(/--document/);
  });

  it('rejects image cache target without an image path', () => {
    expect(() => validateCacheTargetArgs('image', {})).toThrow(/--image/);
  });

  it('allows asset-backed cache targets when the matching path is present', () => {
    expect(() =>
      validateCacheTargetArgs('document', { documentPath: 'samples/documents/earth.pdf' }),
    ).not.toThrow();
    expect(() =>
      validateCacheTargetArgs('image', { imagePath: 'samples/images/prop1.png' }),
    ).not.toThrow();
  });
});
