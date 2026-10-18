import { describe, expect, it } from 'vitest';

import { maskEmail, maskToken } from '../../src/shared/mask.js';

describe('maskToken', () => {
  it('keeps the first 5 and last 4 characters', () => {
    expect(maskToken(`1//0g${'A'.repeat(40)}xYz4`)).toBe('1//0g…xYz4');
  });

  it('hides a short value completely', () => {
    expect(maskToken('short-value')).toBe('…');
  });
});

describe('maskEmail', () => {
  it.each([
    ['person@example.com', 'p***@example.com'],
    ['a@example.com', 'a***@example.com'],
    ['not-an-address', '***'],
    ['@example.com', '***'],
    ['user@', '***'],
  ])('%s → %s', (address, masked) => {
    expect(maskEmail(address)).toBe(masked);
  });
});
