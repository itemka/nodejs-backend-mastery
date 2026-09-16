import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT_PATH = join(REPO_ROOT, 'scripts', 'check-secrets.mjs');

describe('check-secrets', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'check-secrets-test-'));
    runGit(tempDir, ['init', '--quiet']);
  });

  afterEach(() => {
    rmSync(tempDir, { force: true, recursive: true });
  });

  it('reports a placeholder credential without printing its value', () => {
    writeFileSync(join(tempDir, 'config.env'), 'PASSWORD = "changeme"\n'); // check-secrets:allow-placeholder
    runGit(tempDir, ['add', 'config.env']);

    const result = spawnSync(process.execPath, [SCRIPT_PATH], {
      cwd: tempDir,
      encoding: 'utf8',
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /config\.env:1:PASSWORD = "/);
    assert.match(result.stderr, /\[REDACTED_PLACEHOLDER_DEFAULT_CREDENTIAL\]/);
    assert.doesNotMatch(result.stderr, /changeme/i);
  });
});

function runGit(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}
