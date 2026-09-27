import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT_PATH = join(REPO_ROOT, 'scripts', 'check-adapters.mjs');

const VALID_FRONTMATTER = [
  '---',
  'name: repo-reviewer',
  'description: Reviews diffs.',
  '---',
  '',
].join('\n');

describe('check-adapters subagent discovery', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'check-adapters-test-'));
    mkdirSync(join(tempDir, '.agents', 'agents'), { recursive: true });
    mkdirSync(join(tempDir, '.claude', 'agents'), { recursive: true });
    // A matching .agents/ source keeps the 1:1 adapter checks quiet, so the
    // assertions below can only be tripped by the discovery contract.
    writeFileSync(join(tempDir, '.agents', 'agents', 'reviewer.md'), '# Reviewer\n');
  });

  afterEach(() => {
    rmSync(tempDir, { force: true, recursive: true });
  });

  const writeAdapter = (contents) => {
    writeFileSync(join(tempDir, '.claude', 'agents', 'reviewer.md'), contents);
    return spawnSync(process.execPath, [SCRIPT_PATH], { cwd: tempDir, encoding: 'utf8' });
  };

  it('accepts an adapter that Claude Code can discover', () => {
    const result = writeAdapter(`${VALID_FRONTMATTER}Body.\n`);

    assert.equal(result.status, 0, result.stderr);
  });

  it('rejects frontmatter that does not open on the first line', () => {
    const result = writeAdapter(`\n${VALID_FRONTMATTER}Body.\n`);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /must open with `---` on the first line/);
  });

  it('rejects a missing name, which Claude Code skips without reporting', () => {
    const result = writeAdapter('---\ndescription: Reviews diffs.\n---\nBody.\n');

    assert.equal(result.status, 1);
    assert.match(result.stderr, /missing `name`/);
  });

  it('rejects a missing description', () => {
    const result = writeAdapter('---\nname: repo-reviewer\n---\nBody.\n');

    assert.equal(result.status, 1);
    assert.match(result.stderr, /missing `description`/);
  });

  for (const [label, fields] of [
    ['malformed YAML', 'name: repo-reviewer\ndescription: [unterminated'],
    ['a comment-only description', 'name: repo-reviewer\ndescription: # TODO'],
    ['a list description', 'name: repo-reviewer\ndescription: [Reviews diffs.]'],
    ['a numeric name', 'name: 123\ndescription: Reviews diffs.'],
    ['duplicate fields', 'name: repo-reviewer\nname: other\ndescription: Reviews diffs.'],
  ]) {
    it(`rejects ${label}`, () => {
      const result = writeAdapter(`---\n${fields}\n---\nBody.\n`);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /subagents Claude Code would skip/);
    });
  }

  it('accepts quoted fields, comments, and a block scalar description', () => {
    const result = writeAdapter(
      '---\nname: "repo-reviewer" # comment\ndescription: >-\n  Reviews diffs\n  for correctness.\n---\nBody.\n',
    );
    assert.equal(result.status, 0, result.stderr);
  });

  for (const [label, paths] of [
    ['malformed YAML', '[unterminated'],
    ['an empty field', ''],
    ['an empty list', '[]'],
    ['a comment-only field', '# TODO'],
    ['a blank list entry', '[" "]'],
    ['a mixed-type list', '["src/**", 42]'],
    ['a mapping', '{src: "**"}'],
  ]) {
    it(`rejects rule paths with ${label}`, () => {
      mkdirSync(join(tempDir, '.claude', 'rules'));
      writeFileSync(
        join(tempDir, '.claude', 'rules', 'example.md'),
        `---\npaths: ${paths}\n---\nRule.\n`,
      );
      const result = writeAdapter(`${VALID_FRONTMATTER}Body.\n`);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /path-scoped rules with invalid frontmatter or `paths`/);
    });
  }

  for (const paths of ['["src/**", "test/**"]', '"src/**, test/**"']) {
    it(`accepts scoped rule paths ${paths}`, () => {
      mkdirSync(join(tempDir, '.claude', 'rules'));
      writeFileSync(
        join(tempDir, '.claude', 'rules', 'example.md'),
        `---\npaths: ${paths}\n---\nRule.\n`,
      );
      const result = writeAdapter(`${VALID_FRONTMATTER}Body.\n`);
      assert.equal(result.status, 0, result.stderr);
    });
  }

  for (const [label, name] of [
    ['a plugin-reserved colon', 'repo:reviewer'],
    ['a leading hyphen', '-reviewer'],
  ]) {
    it(`rejects a name with ${label}`, () => {
      const result = writeAdapter(`---\nname: ${name}\ndescription: Reviews diffs.\n---\nBody.\n`);

      assert.equal(result.status, 1);
      assert.match(result.stderr, /invalid `name`/);
    });
  }
});
