// Stop hook: typecheck only workspaces touched since HEAD (incl. uncommitted + untracked).
// Exits 2 on failure to keep the agent honest about a green typecheck before stopping.

import { readStdinJson, repoRoot } from './lib/hook-utils.mjs';
import {
  changedFilesSinceHead,
  packageNamesForChangedFiles,
  runPnpmScriptForPackages,
} from '../../scripts/lib/changed-workspaces.mjs';

const main = () => {
  const payload = readStdinJson();
  // Avoid recursing if Claude/Codex already invoked us mid-stop.
  if (payload?.stop_hook_active) return 0;

  const root = repoRoot(payload);
  const files = changedFilesSinceHead({ root });
  if (files.length === 0) return 0;

  const packages = packageNamesForChangedFiles('typecheck', { files, root });
  if (packages.length === 0) return 0;

  return runPnpmScriptForPackages('typecheck', packages, { root }) === 0 ? 0 : 2;
};

process.exit(main());
