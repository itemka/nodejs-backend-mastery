import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const HOOK_PATH = join(REPO_ROOT, '.agents/hooks/sync-before-commit.mjs');
const SYNC_PATH = join(REPO_ROOT, 'scripts/sync-mcp-to-codex.mjs');

describe('sync-before-commit snapshot validation', () => {
  let root;
  let env;
  const run = (command, args, options = {}) =>
    spawnSync(command, args, { cwd: root, env, encoding: 'utf8', ...options });
  const git = (args) => {
    const result = run('git', args);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  const writeSource = (command) =>
    writeFileSync(
      join(root, '.mcp.json'),
      JSON.stringify({ mcpServers: { example: { command } } }),
    );
  const hook = (command, cwd = root) =>
    run(process.execPath, [HOOK_PATH], {
      cwd,
      input: JSON.stringify({ cwd, tool_input: { command } }),
    });

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'commit-hook-test-')));
    env = { ...process.env };
    delete env.CLAUDE_PROJECT_DIR;
    delete env.CODEX_PROJECT_DIR;
    git(['init', '--quiet']);
    // Use the real guardrails while keeping all Git state in this fixture.
    symlinkSync(join(REPO_ROOT, 'scripts'), join(root, 'scripts'), 'dir');
    writeSource('original-server');
    const generated = run(process.execPath, [SYNC_PATH]);
    assert.equal(generated.status, 0, generated.stderr);
    git(['add', '.mcp.json', '.codex/config.toml']);
    writeSource('unstaged-server');
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('checks the current index without staging an unrelated working-tree change', () => {
    const before = git(['diff', '--cached', '--binary']);
    const result = hook('git commit -m "fixture"');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(git(['diff', '--cached', '--binary']), before);
    assert.match(result.stdout, /MCP config is current in the Git index/);
  });

  it('blocks stale staged output and succeeds after both files are staged', () => {
    git(['add', '.mcp.json']);
    assert.equal(hook('git commit -m "fixture"').status, 2);
    assert.equal(run(process.execPath, [SYNC_PATH]).status, 0);
    assert.equal(hook('git commit -m "fixture"').status, 2);
    git(['add', '.codex/config.toml']);
    assert.equal(hook('git commit -m "fixture"').status, 0);
  });

  it('resolves the same index from a nested directory', () => {
    const nested = join(root, 'nested');
    mkdirSync(nested);
    const result = hook('git commit --amend --no-edit', nested);
    assert.equal(result.status, 0, result.stderr);
  });

  for (const command of [
    'git commit -am "fixture"',
    'git commit --all -m "fixture"',
    'git commit --al -m "fixture"',
    'git commit -im "fixture" .mcp.json',
    'git commit --only -m "fixture" .mcp.json',
    'git commit -m "fixture" -- .mcp.json',
    'git commit -m "fixture" .mcp.json',
    'git commit --pathspec-from-file=paths.txt -m "fixture"',
    'git commit --interactive',
    'git commit -p',
    'git commit --fixup=reword:HEAD',
    'git add .mcp.json && git commit -m "fixture"',
    'git add .mcp.json\ngit commit -m "fixture"',
    'bash -c \'git add .mcp.json && git commit -m "fixture"\'',
    'git -C elsewhere commit -m "fixture"',
    'git commit -m "$(git add .mcp.json)"',
    'git commit -m "`git add .mcp.json`"',
    'git commit -m "costs $5"',
    String.raw`git commit -m $'ansi\nquoted'`,
    'git commit -m "$(cat <<\'EOF\'\nsubject\nEOF\n)"',
    'git commit -m "subject\n\nbody"',
    'git commit $COMMIT_FLAGS',
    'git commit -m {message,--all}',
    'git commit -m *',
    'git commit -m message?',
  ]) {
    it(`requires separate staging for ${command}`, () => {
      const before = git(['diff', '--cached', '--binary']);
      const result = hook(command);
      assert.equal(result.status, 2, result.stdout + result.stderr);
      assert.match(result.stderr, /Stage changes in a separate tool call/);
      assert.equal(git(['diff', '--cached', '--binary']), before);
    });
  }

  for (const command of [
    'git commit -qm"fixture"',
    'git commit -m "mentions --all and -a in the message"',
    'git commit --message="fixture" --signoff',
    'git commit --amend --no-edit --no-gpg-sign',
    'git commit -S --allow-empty -m "fixture"',
    'git commit --fixup=HEAD',
    'git commit -m "literal {braces} and [glob]*? characters"',
    "git commit -m 'literal {braces} and [glob]*? characters'",
    "git commit -m 'handle `null` body'",
    "git commit -m 'fix $PATH handling' -m 'uses $(literal) text'",
    'git commit -m "escaped \\$HOME and \\`tick\\`"',
    'git commit -m "subject" -m "body" --trailer "Co-Authored-By: Example <example@example.test>"',
  ]) {
    it(`accepts index-only options in ${command}`, () => {
      const result = hook(command);
      assert.equal(result.status, 0, result.stderr);
    });
  }

  it('ignores commands that do not commit', () => {
    const result = hook('git add .mcp.json && git status');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
  });
});
