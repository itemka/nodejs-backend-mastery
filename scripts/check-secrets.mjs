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

const CREDENTIAL_KEY_PATTERN = String.raw`(?:(?:[A-Za-z0-9]+[_-])*(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?key|auth[_-]?token|token|credential)s?|[A-Za-z][A-Za-z0-9]*(?:Password|Passwd|Pwd|Secret|ApiKey|AccessKey|AuthToken|Token|Credential)s?)`;
const PLACEHOLDER_VALUE_PATTERN = String.raw`(?:changeme|change[_-]?me|your[_-]?(?:api[_-]?)?(?:key|secret|token|password)[_-]?here|password123|passw0rd|admin|admin123|secret123|placeholder|replace[_-]?me|example[_-]?(?:key|secret)|dummy[_-]?secret)`;

// Narrow escape hatch for a placeholder that is deliberate and unusable. Unlike
// ALLOWLIST, it silences only the placeholder rule on the marked line — the file
// is still scanned for every real credential pattern.
const PLACEHOLDER_ALLOW_MARKER = 'check-secrets:allow-placeholder';

const PLACEHOLDER_PATTERNS = [
  {
    name: 'Placeholder/default credential',
    re: new RegExp(
      String.raw`(["']?\b${CREDENTIAL_KEY_PATTERN}\b["']?\s*[:=]\s*["']?)${PLACEHOLDER_VALUE_PATTERN}\b`,
      'gi',
    ),
    redactValueOnly: true,
    remediation:
      'Replace with a freshly generated value; placeholders must not reach a real environment. ' +
      `A deliberate, unusable placeholder can opt out with a "${PLACEHOLDER_ALLOW_MARKER}" comment on the same line.`,
    allowMarker: PLACEHOLDER_ALLOW_MARKER,
    selfTest: {
      matches: [
        'PASSWORD = "ChangeMe"',
        'JWT_SECRET = "changeme"',
        'sessionSecret = "changeme"',
        'DATABASE_PASSWORD = "changeme"',
        'API_KEY = "your-key-here"',
        'PASSWORD = "admin"',
      ],
      nonMatches: ['username = "changeme"', 'secretary = "changeme"'],
    },
  },
];

const PLACEHOLDER_EXEMPT_SUFFIXES = ['.example', '.sample', '.template', '.md'];

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

// Preserve file, line, and credential-key context while keeping every matched
// value out of terminal and CI logs.
const redactHits = (text, matchingPatterns) => {
  let redacted = text;
  const redactionPatterns = new Set([...PATTERNS, ...matchingPatterns]);

  for (const { name, re, redactValueOnly } of redactionPatterns) {
    re.lastIndex = 0;
    const replacement = redactValueOnly ? `$1${redactionLabel(name)}` : redactionLabel(name);
    redacted = redacted.replaceAll(re, replacement);
  }
  return redacted;
};

const isPlaceholderExempt = (file) => {
  const normalizedFile = file.toLowerCase();
  return PLACEHOLDER_EXEMPT_SUFFIXES.some((suffix) => normalizedFile.endsWith(suffix));
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

const scanPatterns = (patterns, files) => {
  if (files.length === 0) return [];

  const findings = [];
  for (const { name, re, remediation, allowMarker } of patterns) {
    re.lastIndex = 0;
    const grepOptions = `-n${re.ignoreCase ? 'i' : ''}IP`;
    const workingTreeHits = grepPattern(['grep', grepOptions, re.source, '--', ...files], name);
    const indexHits = grepPattern(
      ['grep', '--cached', grepOptions, re.source, '--', ...files],
      name,
    );
    const hits = [...new Set([...workingTreeHits, ...indexHits])].filter(
      (hit) => !allowMarker || !hit.includes(allowMarker),
    );
    if (hits.length > 0) {
      findings.push({ name, hits: redactHits(hits.join('\n'), patterns), remediation });
    }
  }
  return findings;
};

const scan = (files) => [
  ...scanPatterns(PATTERNS, files),
  ...scanPatterns(
    PLACEHOLDER_PATTERNS,
    files.filter((file) => !isPlaceholderExempt(file)),
  ),
];

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

// Prove every scoped placeholder expression still matches its own fixtures so a
// broken pattern cannot silently weaken the commit guardrail.
const assertPlaceholderPatterns = () => {
  const dir = mkdtempSync(join(tmpdir(), 'check-placeholders-'));
  const fixturePath = join(dir, 'fixture.txt');
  try {
    for (const { name, re, selfTest } of PLACEHOLDER_PATTERNS) {
      writeFileSync(fixturePath, `${[...selfTest.matches, ...selfTest.nonMatches].join('\n')}\n`);
      const res = spawnSync(
        'git',
        ['grep', '--no-index', '-niIP', re.source, '--', 'fixture.txt'],
        {
          cwd: dir,
          encoding: 'utf8',
        },
      );

      const missingMatches = selfTest.matches.filter((fixture) => !res.stdout.includes(fixture));
      const unexpectedMatches = selfTest.nonMatches.filter((fixture) =>
        res.stdout.includes(fixture),
      );
      if (
        res.status === GREP_EXIT_MATCH &&
        missingMatches.length === 0 &&
        unexpectedMatches.length === 0
      ) {
        continue;
      }

      const stderr = (res.stderr ?? '').trim();
      console.error(
        `${ui.prefix('[check:secrets]')} ` +
          ui.error(`the "${name}" pattern failed its self-test; update the pattern or fixture.`) +
          `${missingMatches.length > 0 ? `\nMissing matches: ${missingMatches.join(', ')}` : ''}` +
          `${unexpectedMatches.length > 0 ? `\nUnexpected matches: ${unexpectedMatches.join(', ')}` : ''}` +
          `${stderr ? `\n${stderr}` : ''}`,
      );
      process.exit(1);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const main = () => {
  assertPcreSupport();
  assertPlaceholderPatterns();
  const files = listTrackedFiles();
  const findings = scan(files);
  if (findings.length === 0) {
    console.log(
      `${ui.prefix('[check:secrets]')} ${ui.ok('no credential patterns in tracked files')}`,
    );
    return 0;
  }
  console.error(`${ui.prefix('[check:secrets]')} ${ui.fail('credential patterns detected:')}`);
  for (const { name, hits, remediation } of findings) {
    console.error(`\n${ui.heading(`## ${name}`)}\n${hits}`);
    if (remediation) console.error(ui.warn(remediation));
  }
  return 1;
};

process.exit(main());
