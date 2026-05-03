import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TEMPLATE_NAME,
  isTemplateName,
  loadTemplate,
  TEMPLATE_NAMES,
} from '../../src/prompts/templates.js';

describe('templates registry', () => {
  it('exposes at least one template name', () => {
    expect(TEMPLATE_NAMES.length).toBeGreaterThan(0);
  });

  it('default template name is in the registry', () => {
    expect(TEMPLATE_NAMES).toContain(DEFAULT_TEMPLATE_NAME);
  });

  it('loads the default template from disk and finds the {{task}} placeholder', async () => {
    const template = await loadTemplate(DEFAULT_TEMPLATE_NAME);

    expect(template).toContain('{{task}}');
  });

  it('isTemplateName narrows known names', () => {
    expect(isTemplateName(DEFAULT_TEMPLATE_NAME)).toBe(true);
    expect(isTemplateName('does-not-exist')).toBe(false);
  });

  it('isTemplateName rejects inherited prototype keys', () => {
    expect(isTemplateName('toString')).toBe(false);
    expect(isTemplateName('__proto__')).toBe(false);
    expect(isTemplateName('constructor')).toBe(false);
  });
});
