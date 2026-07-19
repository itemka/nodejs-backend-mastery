// node:test coverage for the pure changed-workspace test selector. Uses the
// real repo package.json layout as fixtures (no mocking): shop-mvc-express
// and @workspaces/cli-output have a `test` script, workspaces/packages/config
// does not.
//
// Run: node --test .agents/hooks/test-changed-workspaces.test.mjs

import assert from 'node:assert/strict';
import test from 'node:test';

import { repoRoot } from '../../scripts/lib/repo.mjs';
import { selectChangedTestWorkspaces } from './lib/select-changed-test-workspaces.mjs';

const root = repoRoot();

test('returns no workspaces for an empty changed-file list', () => {
  assert.deepEqual(selectChangedTestWorkspaces([], { root }), []);
});

test('ignores docs-only changes', () => {
  const files = ['docs/README.md', 'workspaces/apps/shop-mvc-express/README.md'];

  assert.deepEqual(selectChangedTestWorkspaces(files, { root }), []);
});

test('ignores root-level file changes (includeRoot defaults to false)', () => {
  assert.deepEqual(selectChangedTestWorkspaces(['package.json'], { root }), []);
});

test('selects a test-capable workspace for a source change', () => {
  const files = ['workspaces/apps/shop-mvc-express/src/app.ts'];

  assert.deepEqual(selectChangedTestWorkspaces(files, { root }), ['shop-mvc-express']);
});

test('selects a test-capable workspace for a config/manifest change', () => {
  const files = ['workspaces/apps/shop-mvc-express/package.json'];

  assert.deepEqual(selectChangedTestWorkspaces(files, { root }), ['shop-mvc-express']);
});

test('skips a workspace that has no test script', () => {
  const files = ['workspaces/packages/config/src/index.ts'];

  assert.deepEqual(selectChangedTestWorkspaces(files, { root }), []);
});

test('selects every touched test-capable workspace, deduplicated', () => {
  const files = [
    'workspaces/apps/shop-mvc-express/src/app.ts',
    'workspaces/apps/shop-mvc-express/src/config.ts',
    'workspaces/packages/cli-output/index.js',
  ];

  const result = selectChangedTestWorkspaces(files, { root }).toSorted();
  assert.deepEqual(result, ['@workspaces/cli-output', 'shop-mvc-express']);
});
