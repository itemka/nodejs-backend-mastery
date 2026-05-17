import { parse } from 'shell-quote';

const ENV_ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;
const SUDO_OPTIONS_WITH_VALUE = new Set(['-C', '-g', '-h', '-p', '-u']);
const SUDO_OPTIONS_WITH_EQUALS_VALUE = ['--chdir=', '--group=', '--host=', '--prompt=', '--user='];
const ENV_OPTIONS_WITH_VALUE = new Set(['-S', '-u', '--unset']);
const ENV_OPTIONS_WITH_EQUALS_VALUE = ['--unset='];
const GIT_OPTIONS_WITH_VALUE = new Set([
  '-C',
  '-c',
  '--config-env',
  '--exec-path',
  '--git-dir',
  '--namespace',
  '--work-tree',
]);
const GIT_OPTIONS_WITH_EQUALS_VALUE = [
  '--config-env=',
  '--exec-path=',
  '--git-dir=',
  '--namespace=',
  '--work-tree=',
];

// Shells that take a script string after `-c`. We re-parse that string so a
// dangerous command hidden inside `bash -c "rm -rf /"` is still detected.
const SHELL_WRAPPERS_WITH_C = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'ash']);
// `eval` takes its argument as a shell program directly. The same goes for
// `xargs -I _ sh -c "..."` etc., but those flow through SHELL_WRAPPERS_WITH_C.
const EVAL_WRAPPERS = new Set(['eval']);

const MAX_WRAPPER_RECURSION = 4;

const preserveShellVariable = (key) => (key ? `$${key}` : '$');

const splitLines = (cmd) => {
  // POSIX shells treat a literal newline as a command terminator equivalent to
  // `;`. shell-quote's tokenizer does not emit a separator for newlines, so we
  // split first and parse each line independently before flattening.
  if (typeof cmd !== 'string') return [];
  return cmd.split(/\r?\n+/).filter((line) => line.trim() !== '');
};

const parseLine = (line) => {
  const chunks = [[]];

  for (const token of parse(line, preserveShellVariable)) {
    if (typeof token === 'string') {
      chunks.at(-1).push(token);
    } else if (token?.op === 'glob' && typeof token.pattern === 'string') {
      chunks.at(-1).push(token.pattern);
    } else if (token?.op) {
      chunks.push([]);
    }
  }

  return chunks.filter((chunk) => chunk.length > 0);
};

const baseName = (token) => token?.split('/').at(-1) ?? '';

const expandWrapperChunk = (tokens, depth) => {
  if (depth >= MAX_WRAPPER_RECURSION) return [tokens];

  // Find the first non-env/sudo command position (mirrors commandIndex without
  // importing it to avoid a circular helper).
  let i = 0;
  while (ENV_ASSIGNMENT_RE.test(tokens[i] ?? '')) i++;
  const head = baseName(tokens[i]);

  if (EVAL_WRAPPERS.has(head)) {
    // `eval foo bar baz` joins its args as a script.
    const script = tokens
      .slice(i + 1)
      .filter((t) => typeof t === 'string')
      .join(' ');
    if (script) return [tokens, ...expandChunks(parseShellCommandRaw(script), depth + 1)];
  }

  if (SHELL_WRAPPERS_WITH_C.has(head)) {
    const args = tokens.slice(i + 1);
    const cIdx = args.indexOf('-c');
    const script = cIdx === -1 ? null : args[cIdx + 1];
    if (typeof script === 'string' && script.length > 0) {
      return [tokens, ...expandChunks(parseShellCommandRaw(script), depth + 1)];
    }
  }

  return [tokens];
};

const expandChunks = (chunks, depth = 0) =>
  chunks.flatMap((chunk) => expandWrapperChunk(chunk, depth));

const parseShellCommandRaw = (cmd) => {
  try {
    return splitLines(cmd).flatMap((line) => parseLine(line));
  } catch {
    return [];
  }
};

export const parseShellCommand = (cmd) => {
  try {
    const raw = splitLines(cmd).flatMap((line) => parseLine(line));
    return { chunks: expandChunks(raw), error: null };
  } catch (error) {
    return { chunks: [], error };
  }
};

// Minimal one-level brace expansion: `/{etc,var}` → ['/etc', '/var'],
// `~/{a,b}` → ['~/a', '~/b']. Cartesian products of multiple braces are
// expanded as well via recursion. Anything that fails to parse falls back to
// the original token so callers can still match it literally.
export const expandBraces = (token) => {
  if (typeof token !== 'string' || !token.includes('{')) return [token];

  const match = token.match(/^([^{]*)\{([^{}]+)\}(.*)$/);
  if (!match) return [token];

  const [, prefix, body, suffix] = match;
  const parts = body.split(',').map((part) => part.trim());
  if (parts.length < 2) return [token];

  return parts.flatMap((part) => expandBraces(`${prefix}${part}${suffix}`));
};

const skipSudoOptions = (tokens, index) => {
  let i = index;

  while (tokens[i]?.startsWith('-')) {
    if (tokens[i] === '--') return i + 1;
    if (SUDO_OPTIONS_WITH_VALUE.has(tokens[i])) i += 2;
    else if (SUDO_OPTIONS_WITH_EQUALS_VALUE.some((prefix) => tokens[i].startsWith(prefix))) i++;
    else i++;
  }

  return i;
};

const skipEnvPrefix = (tokens, index) => {
  let i = index;
  if (tokens[i] !== 'env') return i;

  i++;
  while (tokens[i]) {
    if (tokens[i] === '--') {
      i++;
      break;
    }
    if (ENV_ASSIGNMENT_RE.test(tokens[i])) {
      i++;
      continue;
    }
    if (ENV_OPTIONS_WITH_VALUE.has(tokens[i])) {
      i += 2;
      continue;
    }
    if (
      tokens[i].startsWith('-') &&
      (tokens[i] === '-i' ||
        tokens[i] === '-' ||
        tokens[i] === '--ignore-environment' ||
        ENV_OPTIONS_WITH_EQUALS_VALUE.some((prefix) => tokens[i].startsWith(prefix)))
    ) {
      i++;
      continue;
    }

    break;
  }

  return i;
};

export const commandIndex = (tokens) => {
  let i = 0;

  while (ENV_ASSIGNMENT_RE.test(tokens[i] ?? '')) i++;
  while (
    tokens[i] === 'sudo' ||
    tokens[i] === 'doas' ||
    tokens[i] === 'command' ||
    tokens[i] === 'env'
  ) {
    if (tokens[i] === 'env') i = skipEnvPrefix(tokens, i);
    else if (tokens[i] === 'sudo' || tokens[i] === 'doas') i = skipSudoOptions(tokens, i + 1);
    else i++;
  }

  return i;
};

export const commandName = (token) => token?.split('/').at(-1);

export const gitSubcommandIndex = (tokens, gitIndex) => {
  let i = gitIndex + 1;

  while (tokens[i]?.startsWith('-')) {
    if (GIT_OPTIONS_WITH_VALUE.has(tokens[i])) i += 2;
    else if (GIT_OPTIONS_WITH_EQUALS_VALUE.some((prefix) => tokens[i].startsWith(prefix))) i++;
    else i++;
  }

  return i;
};
