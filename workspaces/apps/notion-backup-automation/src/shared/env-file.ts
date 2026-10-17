import { randomBytes } from 'node:crypto';
import { chmod, readFile, rename, rm, writeFile } from 'node:fs/promises';

const namePattern = /^[A-Z][A-Z0-9_]*$/;
/** Token-safe characters only, so a value never needs quoting for `process.loadEnvFile`. */
const valuePattern = /^[\w+/=.:@~-]*$/;
const assignmentPattern = /^\s*(?:export\s+)?([A-Za-z_]\w*)\s*=/;

/**
 * Sets `NAME=value` lines in an env file such as `.env.local`, in place: an existing line is
 * replaced (later duplicates are removed), a new one is appended, and comments and other lines
 * are kept. The file is replaced atomically and ends with mode 0600.
 */
export async function upsertEnvFile(
  filePath: string,
  values: Readonly<Record<string, string>>,
): Promise<void> {
  for (const [name, value] of Object.entries(values)) {
    if (!namePattern.test(name)) {
      throw new Error(`Invalid env variable name: ${name}`);
    }

    if (!valuePattern.test(value)) {
      throw new Error(`The value for ${name} contains characters that need quoting`);
    }
  }

  const pending = new Map(Object.entries(values));
  const lines: string[] = [];

  for (const line of await readLines(filePath)) {
    const name = assignmentPattern.exec(line)?.[1];

    if (name === undefined || !Object.hasOwn(values, name)) {
      lines.push(line);
    } else if (pending.has(name)) {
      lines.push(`${name}=${pending.get(name) ?? ''}`);
      pending.delete(name);
    }
    // Otherwise it is a later duplicate of a name already written: drop it, or it would win.
  }

  for (const [name, value] of pending) {
    lines.push(`${name}=${value}`);
  }

  await writeAtomically(filePath, `${lines.join('\n')}\n`);
}

async function readLines(filePath: string): Promise<string[]> {
  try {
    const content = await readFile(filePath, 'utf8');
    const lines = content.split('\n');

    // Drop the empty string after the final newline; it is added back on write.
    return lines.at(-1) === '' ? lines.slice(0, -1) : lines;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}

async function writeAtomically(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.${randomBytes(6).toString('hex')}.tmp`;

  try {
    await writeFile(tempPath, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true });

    throw error;
  }

  await chmod(filePath, 0o600);
}
