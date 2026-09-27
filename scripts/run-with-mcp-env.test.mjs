import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';

const SCRIPT_PATH = fileURLToPath(new URL('run-with-mcp-env.mjs', import.meta.url));

describe('run-with-mcp-env', () => {
  let root;
  let env;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'mcp-env-test-')));
    const git = spawnSync('git', ['init', '--quiet'], { cwd: root, encoding: 'utf8' });
    assert.equal(git.status, 0, git.stderr);
    env = { ...process.env };
    for (const name of ['TOKEN', 'MCP_ENV_FILE', 'CLAUDE_PROJECT_DIR', 'CODEX_PROJECT_DIR'])
      delete env[name];
    writeFileSync(
      join(root, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          example: { url: 'https://example.test', headers: { Authorization: 'Bearer ${TOKEN}' } },
        },
      }),
    );
    writeFileSync(join(root, '.mcp.env'), 'TOKEN="private test value"\n', { mode: 0o600 });
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const run = (args, options = {}) =>
    spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
      cwd: root,
      env,
      encoding: 'utf8',
      ...options,
    });

  it('loads dotenv values without exposing them and preserves command arguments', () => {
    writeFileSync(
      join(root, '.mcp.env'),
      'TOKEN="private test value"\nEXTRA="spaces # and symbols"\n',
    );
    const result = run([
      '--',
      process.execPath,
      '-e',
      'require("node:assert/strict").equal(process.env.TOKEN, "private test value"); require("node:assert/strict").equal(process.env.EXTRA, "spaces # and symbols"); require("node:assert/strict").equal(process.argv[1], "two words");',
      'two words',
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout + result.stderr, '');
  });

  it('keeps exported values ahead of the env file', () => {
    env.TOKEN = 'exported fixture';
    const result = run([
      process.execPath,
      '-e',
      'require("node:assert/strict").equal(process.env.TOKEN, "exported fixture")',
    ]);
    assert.equal(result.status, 0, result.stderr);
  });

  it('supports a private file override', () => {
    const path = join(root, 'private.env');
    writeFileSync(path, 'TOKEN="override fixture"\n');
    env.MCP_ENV_FILE = path;
    const result = run([
      process.execPath,
      '-e',
      'require("node:assert/strict").equal(process.env.TOKEN, "override fixture")',
    ]);
    assert.equal(result.status, 0, result.stderr);
  });

  it('resolves the env file and launches from the repo root when called in a nested directory', () => {
    const cwd = join(root, 'nested');
    mkdirSync(cwd);
    env.MCP_ENV_FILE = '.mcp.env';
    const result = run(
      [
        process.execPath,
        '-e',
        'require("node:assert/strict").equal(process.cwd(), process.argv[1]);',
        root,
      ],
      { cwd },
    );
    assert.equal(result.status, 0, result.stderr);
  });

  it('does not evaluate shell syntax or dotenv variable references', () => {
    writeFileSync(join(root, '.mcp.env'), 'TOKEN="$(false) ${OTHER} `false`"\n');
    const result = run([
      process.execPath,
      '-e',
      'require("node:assert/strict").equal(process.env.TOKEN, "$(false) ${OTHER} `false`")',
    ]);
    assert.equal(result.status, 0, result.stderr);
  });

  for (const value of ['', '   ']) {
    it(`fails before launch for a ${value ? 'whitespace-only' : 'missing'} required variable`, () => {
      writeFileSync(join(root, '.mcp.env'), `TOKEN="${value}"\n`);
      const result = run([process.execPath, '-e', 'console.log("should-not-launch")']);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Missing MCP environment variables: TOKEN/);
      assert.equal(result.stdout, '');
    });
  }

  it('launches from exported variables when the default env file is absent', () => {
    rmSync(join(root, '.mcp.env'));
    env.TOKEN = 'exported fixture';
    const result = run([
      process.execPath,
      '-e',
      'require("node:assert/strict").equal(process.env.TOKEN, "exported fixture")',
    ]);
    assert.equal(result.status, 0, result.stderr);
  });

  it('reports missing variables, not the file, when the default env file is absent', () => {
    rmSync(join(root, '.mcp.env'));
    const result = run([process.execPath, '-e', 'console.log("should-not-launch")']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Missing MCP environment variables: TOKEN/);
    assert.doesNotMatch(result.stderr, /Cannot read the private MCP env file/);
    assert.equal(result.stdout, '');
  });

  it('reports a missing explicit env file even when variables are exported', () => {
    env.MCP_ENV_FILE = 'absent.env';
    env.TOKEN = 'exported fixture';
    const result = run([process.execPath, '-e', 'console.log("should-not-launch")']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Cannot read the private MCP env file/);
    assert.equal(result.stdout, '');
  });

  it('reports missing files without starting a client', () => {
    env.MCP_ENV_FILE = 'absent.env';
    const result = run([process.execPath, '-e', 'console.log("should-not-launch")']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Cannot read the private MCP env file/);
    assert.equal(result.stdout, '');
  });

  it('redacts malformed config errors', () => {
    writeFileSync(join(root, '.mcp.json'), '{"token":"private-fixture" broken}');
    const result = run([process.execPath]);
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stderr, /private-fixture/);
  });

  it('preserves child exit codes and handles a missing executable without echoing args', () => {
    assert.equal(run([process.execPath, '-e', 'process.exit(23)']).status, 23);
    const result = run(['nonexistent-mcp-fixture-command', 'private-fixture']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Could not start/);
    assert.doesNotMatch(result.stderr, /private-fixture/);
  });

  it('prints help without reading any credentials', () => {
    env.MCP_ENV_FILE = 'absent.env';
    assert.equal(run(['--help']).status, 0);
    assert.equal(run([]).status, 1);
  });

  it('forwards termination to the child and waits for its exit', { timeout: 5000 }, async () => {
    const child = spawn(
      process.execPath,
      [
        SCRIPT_PATH,
        process.execPath,
        '-e',
        'process.on("SIGTERM", () => process.exit(42)); setInterval(() => {}, 1000); console.log("ready");',
      ],
      { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    try {
      const code = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', resolve);
        child.stdout.once('data', () => child.kill('SIGTERM'));
      });
      assert.equal(code, 42);
    } finally {
      if (child.exitCode === null) child.kill('SIGTERM');
    }
  });
});
