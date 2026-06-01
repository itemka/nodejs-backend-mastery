// Workspace-scoped validate: lint + typecheck + test on packages touched since HEAD.
// Used by hooks for fast feedback; also runnable as `pnpm run validate:changed`.

import * as ui from '@workspaces/cli-output';

import {
  packageNamesForChangedFiles,
  runPnpmScriptForPackages,
} from './lib/changed-workspaces.mjs';

const runFilter = (script, packages) => {
  if (packages.length === 0) {
    console.log(
      `${ui.prefix('[validate:changed]')} ${ui.muted(`no workspace has a "${script}" script for changed files — skipping`)}`,
    );
    return 0;
  }
  console.log(
    `${ui.prefix('[validate:changed]')} ${ui.accent(`${ui.symbols.pointer} running ${script}`)} on ${packages.join(', ')}`,
  );

  return runPnpmScriptForPackages(script, packages);
};

const main = () => {
  for (const script of ['lint', 'typecheck', 'test']) {
    const code = runFilter(script, packageNamesForChangedFiles(script, { includeRoot: true }));
    if (code !== 0) {
      console.error(`${ui.prefix('[validate:changed]')} ${ui.fail(`${script} failed`)}`);
      return code;
    }
  }
  return 0;
};

process.exit(main());
