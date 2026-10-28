import { describe, expect, it } from 'vitest';

import { ConfigError, readIntegrations } from '../src/config/env.js';
import { env, integration } from './support.js';

describe('integration registry', () => {
  it('accepts explicit HTTPS routes without backup imports', () => {
    expect(readIntegrations(env)).toEqual([integration]);
  });

  it.each([
    [integration, { ...integration, id: 'other' }],
    [{ ...integration, commands: ['help'] }],
    [{ ...integration, url: 'http://unsafe.example' }],
    [{ ...integration, url: 'https://user:pass@unsafe.example' }],
    [{ ...integration, token: 'short' }],
    [{ ...integration, id: 'route:ambiguous' }],
    [{ ...integration, id: 's' }],
    [{ ...integration, arbitrary: 'field' }],
  ])('rejects conflicting, unsafe and ambiguous registry entries', (...routes) => {
    expect(() => readIntegrations({ HUB_INTEGRATIONS: JSON.stringify(routes) })).toThrow(
      ConfigError,
    );
  });

  it('refuses malformed JSON and an unconfigured legacy destination without exposing secrets', () => {
    expect(() => readIntegrations({ HUB_INTEGRATIONS: 'invalid' })).toThrow(
      'Hub configuration is incomplete or invalid',
    );
    expect(() => readIntegrations({ ...env, HUB_LEGACY_INTEGRATION_ID: 'unknown' })).toThrow(
      ConfigError,
    );
  });
});
