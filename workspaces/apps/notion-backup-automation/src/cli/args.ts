import { parseArgs } from 'node:util';

export type ParsedCommand =
  | { readonly command: 'auth:google'; readonly pickFolders: boolean; readonly print: boolean }
  | { readonly command: 'auth:notion' }
  /** `emailSince` is a local date, `YYYY-MM-DD`, in the backup time zone. */
  | { readonly command: 'doctor'; readonly emailSince: string | undefined }
  | { readonly command: 'dev:download'; readonly emailSince: string | undefined }
  | { readonly command: 'dev:trigger'; readonly dryRun: boolean; readonly headed: boolean }
  | { readonly command: 'dev:upload'; readonly path: string }
  | { readonly command: 'drive:check'; readonly year: string | undefined }
  | { readonly command: 'drive:init' }
  | { readonly command: 'help' };

/** A wrong command line. The message is shown with the usage text. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export const USAGE = `Usage: pnpm --filter notion-backup-automation cli <command> [options]

Commands:
  auth:google [--print] [--pick-folders]
      Google consent in the browser. Saves GOOGLE_REFRESH_TOKEN to .env.local and prints it
      masked; --print also prints the token itself, for 1Password. --pick-folders instead runs
      the Drive Picker grant (S6 fallback 1) and saves nothing.
  auth:notion
      Opens Chrome on the Notion login page; you sign in yourself, including MFA. Saves the
      session, encrypted, to Redis for APP_ENV, then checks it again in a headless browser.
  drive:check [--year YYYY]
      S6 checks C1–C4 against GOOGLE_DRIVE_BACKUP_ROOT_FOLDER_ID (default year: the current one).
  drive:init
      S6 fallback 2: creates the app-owned "Full Workspace" folder, or finds the existing one.
  doctor [--email-since YYYY-MM-DD]
      Checks the local configuration, Google, Gmail, Drive and Redis. The export email search
      starts at the start of --email-since, a day in BACKUP_TIME_ZONE (default: 30 days ago).
  dev:upload <file.zip>
      With APP_ENV=dev only: uploads the file as today's backup into _dev/<YYYY>/ in the Drive
      root, with its .sha256 sidecar. A file already there with the same SHA-256 is not sent again.
  dev:trigger [--dry-run] [--headed]
      With APP_ENV=dev only: requests a real workspace export in Notion's Settings with the
      saved session. --dry-run stops at the export dialog and cancels it; --headed shows the window.
  dev:download [--email-since YYYY-MM-DD]
      With APP_ENV=dev only: downloads the newest export since --email-since (default: 7 days
      ago) with the saved session's cookies, checks the ZIP, and deletes it. Nothing is uploaded.

The commands read .env.local in the app directory.`;

const yearPattern = /^\d{4}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

/** Parses `argv` after the script name. Unknown commands, options and values are errors. */
export function parseCommand(argv: readonly string[]): ParsedCommand {
  const [name, ...rest] = argv;

  if (name === undefined || name === 'help' || name === '--help' || name === '-h') {
    return { command: 'help' };
  }

  switch (name) {
    case 'auth:google': {
      const { values } = parse(rest, {
        'pick-folders': { type: 'boolean' },
        print: { type: 'boolean' },
      });

      if (values['pick-folders'] === true && values.print === true) {
        throw new UsageError('--print and --pick-folders cannot be combined');
      }

      return {
        command: 'auth:google',
        pickFolders: values['pick-folders'] === true,
        print: values.print === true,
      };
    }

    case 'auth:notion': {
      parse(rest, {});

      return { command: 'auth:notion' };
    }

    case 'dev:download': {
      return { command: 'dev:download', emailSince: emailSinceOption(rest) };
    }

    case 'dev:trigger': {
      const { values } = parse(rest, {
        'dry-run': { type: 'boolean' },
        headed: { type: 'boolean' },
      });

      return {
        command: 'dev:trigger',
        dryRun: values['dry-run'] === true,
        headed: values.headed === true,
      };
    }

    case 'doctor': {
      return { command: 'doctor', emailSince: emailSinceOption(rest) };
    }

    case 'dev:upload': {
      const { positionals } = parse(rest, {}, true);

      if (positionals.length !== 1 || positionals[0] === undefined || positionals[0] === '') {
        throw new UsageError('dev:upload takes exactly one file');
      }

      return { command: 'dev:upload', path: positionals[0] };
    }

    case 'drive:check': {
      const { year } = parse(rest, { year: { type: 'string' } }).values;

      if (year !== undefined && !yearPattern.test(year)) {
        throw new UsageError('--year must be four digits, such as 2026');
      }

      return { command: 'drive:check', year };
    }

    case 'drive:init': {
      parse(rest, {});

      return { command: 'drive:init' };
    }

    default: {
      throw new UsageError(`Unknown command: ${name}`);
    }
  }
}

/** `--email-since YYYY-MM-DD`, the only option of `doctor` and `dev:download`. */
function emailSinceOption(args: readonly string[]): string | undefined {
  const since = parse(args, { 'email-since': { type: 'string' } }).values['email-since'];

  return since === undefined ? undefined : toLocalDate(since);
}

type OptionConfig = Record<string, { type: 'boolean' | 'string' }>;

function parse<T extends OptionConfig>(
  args: readonly string[],
  options: T,
  allowPositionals = false,
) {
  try {
    return parseArgs({ allowPositionals, args: [...args], options, strict: true });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : 'Invalid arguments');
  }
}

/** A calendar date such as `2026-10-01`; impossible dates like `2026-02-30` are rejected. */
function toLocalDate(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);

  if (
    !datePattern.test(value) ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new UsageError('--email-since must be a date, such as 2026-10-01');
  }

  return value;
}
