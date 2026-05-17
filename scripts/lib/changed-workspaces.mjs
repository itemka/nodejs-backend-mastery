// Shared helpers for mapping changed files to packages with runnable scripts.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import { git, repoRoot } from './repo.mjs';

export const changedFilesSinceHead = ({ root = repoRoot() } = {}) => {
  const tracked = git(['diff', '--name-only', 'HEAD'], { root }).split('\n');
  const untracked = git(['ls-files', '--others', '--exclude-standard'], { root }).split('\n');

  return [...tracked, ...untracked].filter(Boolean);
};

const readPackage = (dir) => {
  try {
    return JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
};

export const packageWithScriptForFile = (
  filePath,
  script,
  { baseDir, includeRoot = false, root = repoRoot() } = {},
) => {
  let dir = dirname(isAbsolute(filePath) ? resolve(filePath) : resolve(baseDir ?? root, filePath));
  const normalizedRoot = resolve(root);

  while (dir !== resolve(dir, '..')) {
    if (!includeRoot && dir === normalizedRoot) return null;

    const package_ = readPackage(dir);
    if (package_?.name && package_.scripts?.[script]) {
      return { dir, name: package_.name };
    }

    if (dir === normalizedRoot) return null;
    dir = dirname(dir);
  }

  return null;
};

export const packageNamesForChangedFiles = (script, options = {}) => {
  const packages = new Set();
  const root = options.root ?? repoRoot();
  const files = options.files ?? changedFilesSinceHead({ root });

  for (const file of files) {
    const package_ = packageWithScriptForFile(file, script, { ...options, root });
    if (package_) packages.add(package_.name);
  }

  return [...packages];
};

export const runPnpmScriptForPackages = (script, packageNames, { root = repoRoot() } = {}) => {
  if (packageNames.length === 0) return 0;

  const filters = packageNames.flatMap((name) => ['--filter', name]);
  const res = spawnSync(
    'pnpm',
    [...filters, '--workspace-concurrency=1', 'run', '--if-present', script],
    { cwd: root, stdio: 'inherit' },
  );

  return res.status ?? 1;
};
