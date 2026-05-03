import * as ts from 'typescript';

import type { TestCaseFormat } from '../datasets/types.js';

export type SyntaxScore = 0 | 10;

export function validateJson(text: string): SyntaxScore {
  try {
    JSON.parse(text.trim());

    return 10;
  } catch {
    return 0;
  }
}

const MAX_REGEX_PATTERN_LENGTH = 1000;

export function validateRegex(text: string): SyntaxScore {
  const pattern = text.trim();

  if (!pattern || pattern.length > MAX_REGEX_PATTERN_LENGTH) {
    return 0;
  }

  try {
    new RegExp(pattern);

    return 10;
  } catch {
    return 0;
  }
}

export function validateTypescript(text: string): SyntaxScore {
  if (!text.trim()) {
    return 0;
  }

  const result = ts.transpileModule(text, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });

  return (result.diagnostics?.length ?? 0) === 0 ? 10 : 0;
}

export function gradeSyntax(text: string, format: TestCaseFormat): SyntaxScore {
  switch (format) {
    case 'json': {
      return validateJson(text);
    }

    case 'regex': {
      return validateRegex(text);
    }

    case 'typescript': {
      return validateTypescript(text);
    }
  }
}
