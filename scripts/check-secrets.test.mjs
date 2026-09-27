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

  it('reports a PEM private key block without printing it', () => {
    // Split so this test source never contains a complete PEM header.
    const header = ['-----BEGIN OPENSSH PRIVATE', 'KEY-----'].join(' ');
    writeFileSync(join(tempDir, 'deploy_key'), `${header}\nprivate-fixture\n`);
    runGit(tempDir, ['add', 'deploy_key']);
    const result = spawnSync(process.execPath, [SCRIPT_PATH], { cwd: tempDir, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /deploy_key:1:\[REDACTED_PRIVATE_KEY_BLOCK\]/);
    assert.ok(!result.stderr.includes(header));
    assert.doesNotMatch(result.stderr, /private-fixture/);
  });

  it('allows the tracked .mcp.env.example template', () => {
    writeFileSync(join(tempDir, '.mcp.env.example'), 'GITHUB_TOKEN=\n');
    runGit(tempDir, ['add', '.mcp.env.example']);
    const result = spawnSync(process.execPath, [SCRIPT_PATH], { cwd: tempDir, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  });

  for (const file of ['.mcp.env', '.mcp.work.env', '.mcp.local.json']) {
    it(`rejects accidentally tracked ${file} even without a recognized token pattern`, () => {
      writeFileSync(join(tempDir, file), 'private-fixture\n');
      runGit(tempDir, ['add', file]);
      const result = spawnSync(process.execPath, [SCRIPT_PATH], { cwd: tempDir, encoding: 'utf8' });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /private MCP files must not be tracked/);
      assert.ok(result.stderr.includes(file));
      assert.doesNotMatch(result.stderr, /private-fixture/);
    });
  }
});

function runGit(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}
