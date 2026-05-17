// Workspace-scoped validate: lint + typecheck + test on packages touched since HEAD.
// Used by hooks for fast feedback; also runnable as `pnpm run validate:changed`.

import {
  packageNamesForChangedFiles,
  runPnpmScriptForPackages,
} from './lib/changed-workspaces.mjs';

const runFilter = (script, packages) => {
  if (packages.length === 0) {
    console.log(
      `[validate:changed] no workspace has a "${script}" script for changed files — skipping`,
    );
    return 0;
  }
  console.log(`[validate:changed] running ${script} on ${packages.join(', ')}`);

  return runPnpmScriptForPackages(script, packages);
};

const main = () => {
  for (const script of ['lint', 'typecheck', 'test']) {
    const code = runFilter(script, packageNamesForChangedFiles(script, { includeRoot: true }));
    if (code !== 0) {
      console.error(`[validate:changed] ${script} failed`);
      return code;
    }
  }
  return 0;
};

process.exit(main());
