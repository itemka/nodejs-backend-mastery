import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const appRoot = path.resolve(import.meta.dirname, '../..');
const browserPackages = ['playwright-core', '@sparticuz/chromium'];

/** The module a runtime import, export or `import()` names; type-only ones are erased. */
function runtimeSpecifier(node: ts.Node): string | undefined {
  if (
    ts.isImportDeclaration(node) &&
    node.importClause?.phaseModifier !== ts.SyntaxKind.TypeKeyword
  ) {
    return ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : undefined;
  }

  if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier !== undefined) {
    return ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : undefined;
  }

  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    const [specifier] = node.arguments;

    return specifier !== undefined && ts.isStringLiteralLike(specifier)
      ? specifier.text
      : undefined;
  }

  return undefined;
}

/**
 * The app's files and the packages an `api/` entry reaches, following every runtime import as
 * Vercel's file trace does, `import()` included.
 */
function traceEntry(entry: string): { files: string[]; packages: string[] } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const pending = [path.join(appRoot, entry)];

  while (pending.length > 0) {
    const file = pending.pop() ?? '';

    if (files.has(file)) {
      continue;
    }

    files.add(file);

    const visit = (node: ts.Node): void => {
      const specifier = runtimeSpecifier(node);

      if (specifier?.startsWith('.') === true) {
        pending.push(path.resolve(path.dirname(file), specifier.replace(/\.js$/, '.ts')));
      } else if (specifier !== undefined) {
        packages.add(specifier);
      }

      ts.forEachChild(node, visit);
    };

    visit(ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest));
  }

  return {
    files: [...files].map((file) => path.relative(appRoot, file)),
    packages: [...packages],
  };
}

function browserCode({ files, packages }: ReturnType<typeof traceEntry>): string[] {
  return [
    ...files.filter((file) => file.startsWith('src/adapters/notion/')),
    ...packages.filter((name) => browserPackages.some((browser) => name.startsWith(browser))),
  ];
}

describe('browser imports', () => {
  it.each(['api/mcp.ts', 'api/integrations/telegram.ts'])(
    '%s never reaches Playwright or serverless Chromium',
    (entry) => {
      expect(browserCode(traceEntry(entry))).toEqual([]);
    },
  );

  it.each(['api/jobs/process/[jobId].ts', 'api/cron/daily.ts'])('%s still does', (entry) => {
    expect(browserCode(traceEntry(entry))).toEqual(
      expect.arrayContaining([
        'src/adapters/notion/browser-launcher.ts',
        'playwright-core',
        '@sparticuz/chromium',
      ]),
    );
  });
});
