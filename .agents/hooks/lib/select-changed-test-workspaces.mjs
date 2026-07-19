// Pure selection logic for which changed-since-HEAD files should trigger
// workspace tests at agent Stop. Kept free of git/process I/O (beyond the
// package.json reads already performed by changed-workspaces.mjs) so
// test-changed-workspaces.test.mjs can exercise it with an injected file
// list instead of the live git tree.

import { packageNamesForChangedFiles } from '../../../scripts/lib/changed-workspaces.mjs';

// Source/config/test files only. Skips docs/README-only changes so an agent
// isn't charged a full workspace test run for a documentation edit.
const TESTABLE_FILE_RE = /\.(?:[mc]?[jt]sx?|json)$/i;

export const selectChangedTestWorkspaces = (files, options = {}) => {
  const testableFiles = files.filter((file) => TESTABLE_FILE_RE.test(file));
  if (testableFiles.length === 0) return [];

  return packageNamesForChangedFiles('test', { ...options, files: testableFiles });
};
