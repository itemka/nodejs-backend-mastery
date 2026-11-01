import { describe, expect, it } from 'vitest';

import { GET as home } from '../../api/home.js';
import { GET as privacy } from '../../api/privacy.js';
import { GET as terms } from '../../api/terms.js';

describe('public pages', () => {
  it.each([
    ['home', home, 'personal tool'],
    ['privacy', privacy, 'Limited Use'],
    ['terms', terms, 'as is'],
  ])('%s answers HTML with no configuration', async (_name, handler, expected) => {
    const response = handler();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
    expect(await response.text()).toContain(expected);
  });
});
