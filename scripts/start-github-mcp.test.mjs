import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';

const SCRIPT_PATH = fileURLToPath(new URL('start-github-mcp.mjs', import.meta.url));
const sharedConfig = JSON.parse(readFileSync(new URL('../.mcp.json', import.meta.url), 'utf8'));
const codexConfig = readFileSync(new URL('../.codex/config.toml', import.meta.url), 'utf8');
const codexArgs = JSON.parse(
  codexConfig.match(/\[mcp_servers\.github\]\ncommand = "node"\nargs = (.+)/)[1],
);

describe('start-github-mcp', () => {
  let root;
  let env;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'github-mcp-test space-')));
    const git = spawnSync('git', ['init', '--quiet'], { cwd: root, encoding: 'utf8' });
    assert.equal(git.status, 0, git.stderr);
    const bin = join(root, 'bin');
    mkdirSync(bin);
    const docker = join(bin, 'docker');
    writeFileSync(
      docker,
      `#!${process.execPath}\nconst assert = require('node:assert/strict');\nassert.equal(process.env.GITHUB_PERSONAL_ACCESS_TOKEN, process.env.EXPECTED_TOKEN);\nassert.deepEqual(process.argv.slice(2), ['run', '-i', '--rm', '-e', 'GITHUB_PERSONAL_ACCESS_TOKEN', 'ghcr.io/github/github-mcp-server:v1.12.2']);\nconsole.log('started');\n`,
    );
    chmodSync(docker, 0o755);
    writeFileSync(join(root, '.mcp.env'), 'GITHUB_TOKEN="private test value"\n', { mode: 0o600 });
    env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      EXPECTED_TOKEN: 'private test value',
    };
    for (const name of ['GITHUB_TOKEN', 'MCP_ENV_FILE', 'CLAUDE_PROJECT_DIR', 'CODEX_PROJECT_DIR'])
      delete env[name];
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const run = () =>
    spawnSync(process.execPath, [SCRIPT_PATH], { cwd: root, env, encoding: 'utf8' });

  it('loads the private token when the editor did not export it', () => {
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'started\n');
    assert.doesNotMatch(result.stderr, /private test value/);
  });

  for (const [client, args] of [
    ['Claude', sharedConfig.mcpServers.github.args],
    ['Codex', codexArgs],
  ]) {
    it(`starts through the ${client} config from a nested workspace directory`, () => {
      mkdirSync(join(root, 'scripts', 'lib'), { recursive: true });
      copyFileSync(SCRIPT_PATH, join(root, 'scripts', 'start-github-mcp.mjs'));
      copyFileSync(
        fileURLToPath(new URL('lib/repo.mjs', import.meta.url)),
        join(root, 'scripts', 'lib', 'repo.mjs'),
      );
      const cwd = join(root, 'workspaces', 'apps', 'example');
      mkdirSync(cwd, { recursive: true });
      const result = spawnSync(process.execPath, args, { cwd, env, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, 'started\n');
      assert.doesNotMatch(result.stderr, /private test value/);
    });
  }

  it('prefers an exported token and names the override without printing its value', () => {
    env.GITHUB_TOKEN = env.EXPECTED_TOKEN = 'exported fixture';
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /exported GITHUB_TOKEN overrides/);
    assert.doesNotMatch(result.stderr, /exported fixture|private test value/);
  });

  it('fails before starting Docker if the token is absent', () => {
    writeFileSync(join(root, '.mcp.env'), 'GITHUB_TOKEN=\n');
    const result = run();
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /GITHUB_TOKEN is missing/);
  });

  it('fails for a missing explicitly selected env file', () => {
    env.MCP_ENV_FILE = 'missing.env';
    const result = run();
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Cannot read the private MCP env file/);
  });
});
