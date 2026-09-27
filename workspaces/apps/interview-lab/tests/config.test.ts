import { describe, expect, it } from 'vitest';

import { validateEnvironment } from '../src/config.js';

describe('environment boundary', () => {
  it('accepts defaults and converts a supplied port', () => {
    expect(validateEnvironment({})).toEqual({
      HOST: '127.0.0.1',
      NODE_ENV: 'development',
      PORT: 3100,
    });
    expect(validateEnvironment({ PORT: '3200' }).PORT).toBe(3200);
  });

  it('rejects a blank host', () => {
    expect(() => validateEnvironment({ HOST: ' ' })).toThrow('Invalid environment fields: HOST');
  });

  it.each(['abc', '', '0', '-1', '65536', '3.5'])('rejects invalid port %s', (port) => {
    expect(() => validateEnvironment({ PORT: port })).toThrow('Invalid environment fields: PORT');
  });

  it('does not include rejected values in configuration errors', () => {
    expect(() => validateEnvironment({ NODE_ENV: 'sensitive-value' })).toThrow(
      'Invalid environment fields: NODE_ENV',
    );
  });
});
