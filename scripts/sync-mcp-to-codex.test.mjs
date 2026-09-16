import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT_PATH = join(REPO_ROOT, 'scripts', 'sync-mcp-to-codex.mjs');

describe('sync-mcp-to-codex', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'sync-mcp-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { force: true, recursive: true });
  });

  it('forwards a same-name environment reference through env_vars', () => {
    writeConfig(tempDir, {
      mcpServers: {
        example: {
          command: 'example-server',
          env: {
            TOKEN: '${TOKEN}',
          },
        },
      },
    });

    const result = runScript(tempDir);

    assert.equal(result.status, 0, result.stderr);
    const generated = readFileSync(join(tempDir, '.codex', 'config.toml'), 'utf8');
    assert.match(generated, /env_vars = \["TOKEN"\]/);
    assert.doesNotMatch(generated, /env\.TOKEN/);
  });

  it('rejects an environment reference that attempts to rename the variable', () => {
    writeConfig(tempDir, {
      mcpServers: {
        example: {
          command: 'example-server',
          env: {
            TOKEN: '${LOCAL_TOKEN}',
          },
        },
      },
    });

    const result = runScript(tempDir);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Codex env_vars cannot rename variables/);
  });

  it('rejects an environment reference embedded in a larger env value', () => {
    writeConfig(tempDir, {
      mcpServers: {
        example: {
          command: 'example-server',
          env: {
            AUTH: 'Bearer ${TOKEN}',
          },
        },
      },
    });

    const result = runScript(tempDir);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /embeds an environment reference in a larger value/);
  });

  it('rejects an environment reference embedded in a header value', () => {
    writeConfig(tempDir, {
      mcpServers: {
        example: {
          headers: {
            Authorization: 'Bearer ${TOKEN}',
          },
          url: 'https://example.test/mcp',
        },
      },
    });

    const result = runScript(tempDir);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Codex does not expand http_headers/);
  });
});

function runScript(cwd) {
  return spawnSync(process.execPath, [SCRIPT_PATH], {
    cwd,
    encoding: 'utf8',
  });
}

function writeConfig(cwd, value) {
  const configPath = join(cwd, '.mcp.json');
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(value, undefined, 2)}\n`);
}
