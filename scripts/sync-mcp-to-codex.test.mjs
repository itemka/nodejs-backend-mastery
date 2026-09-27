import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    assert.match(result.stderr, /unsupported environment reference/);
  });

  it('converts bearer and custom header references without reading the environment', () => {
    writeConfig(tempDir, {
      mcpServers: {
        example: {
          headers: {
            Authorization: 'Bearer ${TOKEN}',
            'X-API-Key': '${SERVICE_KEY}',
            'X-Region': 'eu',
          },
          type: 'http',
          url: 'https://example.test/mcp',
        },
      },
    });

    const result = runScript(tempDir, [], {
      TOKEN: 'never-write-this-value',
      SERVICE_KEY: 'also-private',
    });
    assert.equal(result.status, 0, result.stderr);
    const generated = readFileSync(join(tempDir, '.codex/config.toml'), 'utf8');
    assert.match(generated, /bearer_token_env_var = "TOKEN"/);
    assert.match(generated, /env_http_headers.X-API-Key = "SERVICE_KEY"/);
    assert.match(generated, /http_headers.X-Region = "eu"/);
    assert.doesNotMatch(generated, /never-write-this-value|also-private|\$\{/);
  });

  it('maps a whole Authorization reference to the complete header environment variable', () => {
    writeConfig(tempDir, {
      mcpServers: {
        example: {
          type: 'http',
          url: 'https://example.test/mcp',
          headers: { authorization: '${COMPLETE_AUTH_HEADER}' },
        },
      },
    });
    const result = runScript(tempDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      readFileSync(join(tempDir, '.codex/config.toml'), 'utf8'),
      /env_http_headers.authorization = "COMPLETE_AUTH_HEADER"/,
    );
  });

  it('keeps credential-like but non-secret names and embedded argument URLs static', () => {
    writeConfig(tempDir, {
      mcpServers: {
        example: {
          command: 'example-server',
          args: [
            '--registry=https://registry.npmjs.org',
            '--max-tokens',
            '4096',
            '--header=X-Region: eu',
          ],
          env: { MAX_TOKENS: '4096', AUTHOR_NAME: 'example', PUBLIC_KEY_ID: 'example' },
        },
      },
    });
    const result = runScript(tempDir);
    assert.equal(result.status, 0, result.stderr);
    const generated = readFileSync(join(tempDir, '.codex/config.toml'), 'utf8');
    assert.match(
      generated,
      /args = \["--registry=https:\/\/registry.npmjs.org", "--max-tokens", "4096", "--header=X-Region: eu"\]/,
    );
    assert.match(generated, /env.MAX_TOKENS = "4096"/);
    assert.match(generated, /env.AUTHOR_NAME = "example"/);
    assert.match(generated, /env.PUBLIC_KEY_ID = "example"/);
  });

  it('accepts home-like path segments inside HTTP URLs', () => {
    writeConfig(tempDir, {
      mcpServers: {
        remote: { type: 'http', url: 'https://docs.example.test/home/mcp' },
        local: { command: 'example-server', args: ['--docs=https://example.test/Users/guide'] },
      },
    });
    const result = runScript(tempDir);
    assert.equal(result.status, 0, result.stderr);
  });

  for (const [label, server] of Object.entries({
    'inline bearer token': {
      type: 'http',
      url: 'https://example.test/mcp',
      headers: { Authorization: 'Bearer private-fixture' },
    },
    'inline API key': {
      type: 'http',
      url: 'https://example.test/mcp',
      headers: { 'X-API-Key': 'private-fixture' },
    },
    'inline stdio secret': {
      command: 'example-server',
      env: { SERVICE_SECRET: 'private-fixture' },
    },
    'split credential option': {
      command: 'example-server',
      args: ['--api-key', 'private-fixture'],
    },
    'equals credential option': { command: 'example-server', args: ['--token=private-fixture'] },
    'camelCase credential option': {
      command: 'example-server',
      args: ['--accessToken', 'private-fixture'],
    },
    'single argument credential option': {
      command: 'example-server',
      args: ['--api-key private-fixture'],
    },
    'split authorization header argument': {
      command: 'example-server',
      args: ['--header', 'Authorization: Bearer private-fixture'],
    },
    'equals credential header argument': {
      command: 'example-server',
      args: ['--header=X-API-Key: private-fixture'],
    },
    'compact authorization header argument': {
      command: 'example-server',
      args: ['-HAuthorization: Bearer private-fixture'],
    },
    'unsupported header template': {
      type: 'http',
      url: 'https://example.test/mcp',
      headers: { Authorization: 'Basic ${TOKEN}' },
    },
    'fallback reference': { command: 'example-server', env: { TOKEN: '${TOKEN:-fallback}' } },
    'argument reference': { command: 'example-server', args: ['${TOKEN}'] },
    'command reference': { command: '${SERVER_COMMAND}' },
    'URL reference': { type: 'http', url: 'https://${HOST}/mcp' },
    'URL credentials': { type: 'http', url: 'https://user:private-fixture@example.test/mcp' },
    'query credentials': { type: 'http', url: 'https://example.test/mcp?api_key=private-fixture' },
    'camelCase query credentials': {
      type: 'http',
      url: 'https://example.test/mcp?apiKey=private-fixture',
    },
    'credentials in an embedded argument URL': {
      command: 'example-server',
      args: ['--endpoint=https://user:private-fixture@example.test/mcp'],
    },
    'camelCase stdio secret': {
      command: 'example-server',
      env: { accessToken: 'private-fixture' },
    },
    'personal path': { command: '/Users/example/private-server' },
    'personal path option': {
      command: 'example-server',
      args: ['--config=/home/example/private-fixture.json'],
    },
    'personal file URL': { command: 'example-server', args: ['file:///Users/example/config'] },
    'root home path': { command: 'example-server', args: ['--config=/root/private-fixture.json'] },
    'inline private key env': {
      command: 'example-server',
      env: { PRIVATE_KEY: 'private-fixture' },
    },
    'camelCase private key env': {
      command: 'example-server',
      env: { privateKey: 'private-fixture' },
    },
    'private key option': { command: 'example-server', args: ['--private-key', 'private-fixture'] },
    // Split so the fixture source never contains a complete PEM header.
    'PEM private key under a neutral name': {
      command: 'example-server',
      env: { SIGNING_MATERIAL: ['-----BEGIN RSA PRIVATE', 'KEY-----\nprivate-fixture'].join(' ') },
    },
    'Redis URL credentials': {
      command: 'example-server',
      args: ['--cache=redis://:private-fixture@localhost:6379/0'],
    },
    'TLS Redis URL': { command: 'example-server', args: ['rediss://cache.example.test:6380'] },
    'credentials in a non-HTTP URL': {
      command: 'example-server',
      args: ['--broker=amqp://user:private-fixture@broker.example.test/vhost'],
    },
    'query credentials in a non-HTTP URL': {
      command: 'example-server',
      args: ['wss://example.test/socket?token=private-fixture'],
    },
    'database argument': { command: 'example-server', args: ['postgresql://localhost/local'] },
    'HTTP env': { type: 'http', url: 'https://example.test/mcp', env: { TOKEN: '${TOKEN}' } },
    'stdio headers': { command: 'example-server', headers: { Authorization: 'Bearer ${TOKEN}' } },
    'duplicate authorization': {
      type: 'http',
      url: 'https://example.test/mcp',
      headers: { Authorization: 'Bearer ${TOKEN}', authorization: '${AUTH_HEADER}' },
    },
    'unsupported transport': { type: 'sse', url: 'https://example.test/mcp' },
    'URL without type': { url: 'https://example.test/mcp' },
    'HTTP type on a command server': { type: 'http', command: 'example-server' },
    'unknown field': { command: 'example-server', bearerToken: 'private-fixture' },
    'non-string argument': { command: 'example-server', args: [123] },
    'missing transport': {},
  })) {
    it(`rejects ${label} without writing config or exposing values`, () => {
      writeConfig(tempDir, { mcpServers: { example: server } });
      const result = runScript(tempDir);
      assert.equal(result.status, 1);
      assert.doesNotMatch(result.stdout + result.stderr, /private-fixture/);
      assert.equal(existsSync(join(tempDir, '.codex/config.toml')), false);
    });
  }

  it('validates credentials even in source servers excluded by the Codex allowlist', () => {
    writeConfig(tempDir, {
      mcpServers: { example: { command: 'example-server', env: { TOKEN: 'private-fixture' } } },
    });
    mkdirSync(join(tempDir, '.codex'));
    writeFileSync(join(tempDir, '.codex/mcp-enabled.json'), '{"enabledMcpServers":[]}');
    assert.equal(runScript(tempDir).status, 1);
  });

  it('does not include malformed JSON contents in errors', () => {
    writeFileSync(join(tempDir, '.mcp.json'), '{"token":"private-fixture" broken}');
    const result = runScript(tempDir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /invalid JSON/);
    assert.doesNotMatch(result.stderr, /private-fixture/);
  });

  it('checks missing, current, and stale output without changing files', () => {
    writeConfig(tempDir, {
      mcpServers: { example: { command: 'example-server', env: { LOG_LEVEL: 'info' } } },
    });
    assert.equal(runScript(tempDir, ['--check']).status, 1);
    assert.equal(existsSync(join(tempDir, '.codex')), false);
    assert.equal(runScript(tempDir).status, 0);
    assert.equal(runScript(tempDir, ['--check']).status, 0);
    const before = readFileSync(join(tempDir, '.codex/config.toml'), 'utf8');
    writeConfig(tempDir, { mcpServers: { example: { command: 'changed-server' } } });
    assert.equal(runScript(tempDir, ['--check']).status, 1);
    assert.equal(readFileSync(join(tempDir, '.codex/config.toml'), 'utf8'), before);
  });

  it('preserves non-MCP settings and regenerates idempotently', () => {
    writeConfig(tempDir, { mcpServers: { example: { command: 'example-server' } } });
    mkdirSync(join(tempDir, '.codex'));
    const target = join(tempDir, '.codex/config.toml');
    writeFileSync(target, 'model = "example-model"\n');
    assert.equal(runScript(tempDir).status, 0);
    const first = readFileSync(target, 'utf8');
    assert.match(first, /^model = "example-model"/);
    assert.equal(runScript(tempDir).status, 0);
    assert.equal(readFileSync(target, 'utf8'), first);
    writeFileSync(target, `${first}\n[mcp_servers.manual]\ncommand = "manual-server"\n`);
    assert.equal(runScript(tempDir, ['--check']).status, 1);
  });

  it('checks staged input and output independently of the working tree', () => {
    const git = (args) => {
      const result = spawnSync('git', args, { cwd: tempDir, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
    };
    git(['init', '--quiet']);
    writeConfig(tempDir, { mcpServers: { example: { command: 'example-server' } } });
    assert.equal(runScript(tempDir).status, 0);
    git(['add', '.mcp.json', '.codex/config.toml']);
    assert.equal(runScript(tempDir, ['--check', '--staged']).status, 0);
    writeConfig(tempDir, { mcpServers: { example: { command: 'changed-server' } } });
    assert.equal(runScript(tempDir, ['--check']).status, 1);
    assert.equal(runScript(tempDir, ['--check', '--staged']).status, 0);
    git(['add', '.mcp.json']);
    assert.equal(runScript(tempDir).status, 0);
    assert.equal(runScript(tempDir, ['--check']).status, 0);
    assert.equal(runScript(tempDir, ['--check', '--staged']).status, 1);
    git(['add', '.codex/config.toml']);
    assert.equal(runScript(tempDir, ['--check', '--staged']).status, 0);
    assert.equal(runScript(tempDir, ['--staged']).status, 1);
  });
});

function runScript(cwd, args = [], env = {}) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

function writeConfig(cwd, value) {
  const configPath = join(cwd, '.mcp.json');
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(value, undefined, 2)}\n`);
}
