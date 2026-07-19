// Stop hook: run tests for changed, test-capable workspaces since HEAD.
// Skips docs-only edits and workspaces without a `test` script (see
// lib/select-changed-test-workspaces.mjs); does not fall back to a full
// root test run.

import { readStdinJson, repoRoot } from './lib/hook-utils.mjs';
import { selectChangedTestWorkspaces } from './lib/select-changed-test-workspaces.mjs';
import {
  changedFilesSinceHead,
  runPnpmScriptForPackages,
} from '../../scripts/lib/changed-workspaces.mjs';

const main = () => {
  const payload = readStdinJson();
  // Avoid recursing if Claude/Codex already invoked us mid-stop.
  if (payload?.stop_hook_active) return 0;

  const root = repoRoot(payload);
  const files = changedFilesSinceHead({ root });
  if (files.length === 0) return 0;

  const packages = selectChangedTestWorkspaces(files, { root });
  if (packages.length === 0) return 0;

  if (runPnpmScriptForPackages('test', packages, { root }) === 0) return 0;

  process.stderr.write(`[hook] tests failed for changed workspace(s): ${packages.join(', ')}\n`);
  return 2;
};

process.exit(main());
