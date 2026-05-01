import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { isDirectExecution } from '../src/main.js';

describe('isDirectExecution', () => {
  it('matches paths whose file URLs require encoding', () => {
    const entrypointPath = path.resolve('workspaces/ai-engineering/llm-chat/tmp path/main.ts');

    expect(isDirectExecution(pathToFileURL(entrypointPath).href, entrypointPath)).toBe(true);
  });

  it('does not match a different entrypoint path', () => {
    const modulePath = path.resolve('workspaces/ai-engineering/llm-chat/src/main.ts');
    const entrypointPath = path.resolve('workspaces/ai-engineering/llm-chat/src/other.ts');

    expect(isDirectExecution(pathToFileURL(modulePath).href, entrypointPath)).toBe(false);
  });
});
