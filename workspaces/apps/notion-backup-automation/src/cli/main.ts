import * as ui from '@workspaces/cli-output';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { ConsentError } from '../adapters/google/loopback-consent.js';
import { LocalBrowserLauncher } from '../adapters/notion/browser-launcher.js';
import { createRedisClient } from '../adapters/persistence/redis-client.js';
import { IntegrationError } from '../application/integration-error.js';
import { ConfigError } from '../config/env.js';
import { describeError } from '../domain/error-catalog.js';
import { systemClock } from '../shared/clock.js';
import { createLogger, logLevels } from '../shared/logger.js';
import { redactString } from '../shared/redact.js';
import { parseCommand, USAGE, UsageError } from './args.js';
import { runAuthGoogle } from './commands/auth-google.js';
import { runAuthNotion } from './commands/auth-notion.js';
import { runDevDownload } from './commands/dev-download.js';
import { runDevTrigger } from './commands/dev-trigger.js';
import { runDevUpload } from './commands/dev-upload.js';
import { runDoctor } from './commands/doctor.js';
import { runDriveCheck } from './commands/drive-check.js';
import { runDriveInit } from './commands/drive-init.js';
import type { CliContext } from './context.js';

/** Runs one command and returns the exit code: 0 success, 1 failure, 2 usage error. */
export async function main(argv: readonly string[], context: CliContext): Promise<number> {
  let parsed;

  try {
    parsed = parseCommand(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      context.print(ui.error(error.message));
      context.print(USAGE);

      return 2;
    }

    throw error;
  }

  try {
    switch (parsed.command) {
      case 'auth:google': {
        return await runAuthGoogle(parsed, context);
      }

      case 'auth:notion': {
        return await runAuthNotion(context);
      }

      case 'dev:download': {
        return await runDevDownload(parsed, context);
      }

      case 'dev:trigger': {
        return await runDevTrigger(parsed, context);
      }

      case 'dev:upload': {
        return await runDevUpload(parsed, context);
      }

      case 'doctor': {
        return await runDoctor(parsed, context);
      }

      case 'drive:check': {
        return await runDriveCheck(parsed, context);
      }

      case 'drive:init': {
        return await runDriveInit(context);
      }

      case 'help': {
        context.print(USAGE);

        return 0;
      }
    }
  } catch (error) {
    reportError(error, context);

    return 1;
  }
}

/** Codes and static messages only. A raw error object may hold request data, so it is never printed. */
function reportError(error: unknown, context: CliContext): void {
  if (error instanceof ConfigError) {
    context.print(ui.fail(`${error.message}. Fill them in .env.local (see .env.example).`));
  } else if (error instanceof IntegrationError) {
    context.print(ui.fail(`${error.code}: ${error.message}`));
    context.print(ui.muted(`Fix: ${describeError(error.code).howToFix}`));
  } else if (error instanceof ConsentError) {
    context.print(ui.fail(`${error.reason}: ${error.message}`));
  } else {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);

    context.print(ui.fail(`Unexpected error. ${redactString(message)}`));
  }
}

const execFileAsync = promisify(execFile);

function createDefaultContext(envFilePath: string): CliContext {
  const print = (text: string) => {
    process.stdout.write(`${text}\n`);
  };

  const level = logLevels.find((name) => name === process.env.LOG_LEVEL) ?? 'warn';

  return {
    browserLauncher: new LocalBrowserLauncher(),
    clock: systemClock,
    createRedis: createRedisClient,
    env: process.env,
    envFilePath,
    logger: createLogger({
      level,
      sink: (_level, line) => {
        process.stderr.write(`${line}\n`);
      },
    }),
    openBrowser: async (url) => {
      print(ui.muted('Opening the consent page. If the browser does not open, visit:'));
      print(url);

      if (process.platform === 'darwin') {
        try {
          await execFileAsync('open', [url]);
        } catch {
          // The URL is printed above.
        }
      }
    },
    print,
  };
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];

  return entry !== undefined && fileURLToPath(import.meta.url) === path.resolve(entry);
}

if (isDirectExecution()) {
  const envFilePath = path.resolve(import.meta.dirname, '../../.env.local');

  if (existsSync(envFilePath)) {
    // Variables already set in the shell win, so `APP_ENV=prod pnpm … cli doctor` works.
    process.loadEnvFile(envFilePath);
  }

  process.exitCode = await main(process.argv.slice(2), createDefaultContext(envFilePath));
}
