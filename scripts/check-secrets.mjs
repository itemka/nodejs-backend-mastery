// Scan tracked files for credentials that must never land in git history.
// Exit 1 on any hit so CI / pre-commit hooks fail loudly.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as ui from '@workspaces/cli-output';

const PATTERNS = [
  { name: 'GitHub PAT', re: /\bgithub_pat_[A-Za-z0-9_]{20,}/g },
  { name: 'GitHub OAuth/legacy PAT', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/g },
  { name: 'OpenAI/Anthropic-style key', re: /\bsk-(?:proj-|live-|ant-)?[A-Za-z0-9_-]{20,}/g },
  { name: 'Stripe live key', re: /\bsk_live_[A-Za-z0-9]{20,}/g },
  { name: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
];

const ALLOWLIST = new Set([
  // This file itself contains the patterns; ignore it.
  'scripts/check-secrets.mjs',
]);

const listTrackedFiles = () => {
  try {
    return execFileSync('git', ['ls-files'], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .filter((f) => !ALLOWLIST.has(f));
  } catch (error) {
    console.error(
      `${ui.prefix('[check:secrets]')} ${ui.error('could not list tracked files:')}`,
      error.message,
    );
    process.exit(1);
  }
};

const redactionLabel = (name) =>
  `[REDACTED_${name
    .toUpperCase()
    .replaceAll(/[^A-Z0-9]+/g, '_')
    .replaceAll(/^_|_$/g, '')}]`;

const redactHits = (text) => {
  let redacted = text;
  for (const { name, re } of PATTERNS) {
    re.lastIndex = 0;
    redacted = redacted.replaceAll(re, redactionLabel(name));
  }
  return redacted;
};

// `git grep` exit codes: 0 = matches, 1 = no matches, anything else = error.
// Patterns use PCRE features (`\b`, `(?:…)`) so we must invoke grep with `-P`.
const GREP_EXIT_MATCH = 0;
const GREP_EXIT_NO_MATCH = 1;

const SELF_TEST_FIXTURE = 'ghp_selftestSAMPLE0123456789abcdef01234';
const SELF_TEST_PATTERN = String.raw`\bghp_[A-Za-z0-9]{30,}`;

const grepPattern = (grepArgs, patternName) => {
  const res = spawnSync('git', grepArgs, { encoding: 'utf8' });
  if (res.status === GREP_EXIT_MATCH) return res.stdout.trim().split('\n').filter(Boolean);
  if (res.status === GREP_EXIT_NO_MATCH) return [];

  const stderr = (res.stderr ?? '').trim();
  console.error(
    `${ui.prefix('[check:secrets]')} ${ui.error(`git grep failed for pattern "${patternName}" (exit ${res.status}).`)} ${stderr}`,
  );
  process.exit(1);
};

const scan = (files) => {
  if (files.length === 0) return [];

  const findings = [];
  for (const { name, re } of PATTERNS) {
    re.lastIndex = 0;
    const workingTreeHits = grepPattern(['grep', '-nIP', re.source, '--', ...files], name);
    const indexHits = grepPattern(['grep', '--cached', '-nIP', re.source, '--', ...files], name);
    const hits = [...new Set([...workingTreeHits, ...indexHits])];
    if (hits.length > 0) findings.push({ name, hits: redactHits(hits.join('\n')) });
  }
  return findings;
};

// Detect a broken grep build (no PCRE support) before scanning, so we never
// silently report "OK" when the engine itself rejected every pattern.
const assertPcreSupport = () => {
  const dir = mkdtempSync(join(tmpdir(), 'check-secrets-'));
  const fixturePath = join(dir, 'fixture.txt');
  try {
    writeFileSync(fixturePath, `${SELF_TEST_FIXTURE}\n`);
    const res = spawnSync(
      'git',
      ['grep', '--no-index', '-nIP', SELF_TEST_PATTERN, '--', 'fixture.txt'],
      { cwd: dir, encoding: 'utf8' },
    );

    if (res.status === GREP_EXIT_MATCH && res.stdout.includes('ghp_')) return;

    const stderr = (res.stderr ?? '').trim();
    console.error(
      `${ui.prefix('[check:secrets]')} ` +
        ui.error(
          `git grep does not support PCRE (-P) on this system. ` +
            `Install a git build with PCRE or update this script.`,
        ) +
        `${stderr ? `\n${stderr}` : ''}`,
    );
    process.exit(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const main = () => {
  assertPcreSupport();
  const files = listTrackedFiles();
  const findings = scan(files);
  if (findings.length === 0) {
    console.log(
      `${ui.prefix('[check:secrets]')} ${ui.ok('no credential patterns in tracked files')}`,
    );
    return 0;
  }
  console.error(`${ui.prefix('[check:secrets]')} ${ui.fail('credential patterns detected:')}`);
  for (const { name, hits } of findings) {
    console.error(`\n${ui.heading(`## ${name}`)}\n${hits}`);
  }
  return 1;
};

process.exit(main());
