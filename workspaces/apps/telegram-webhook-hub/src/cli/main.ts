import { existsSync } from 'node:fs';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { runTelegramSetup } from './setup.js';

const envPath = path.resolve('.env.local');

if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

async function saveChat(chatId: string): Promise<void> {
  const text = existsSync(envPath) ? await readFile(envPath, 'utf8') : '';
  const line = `TELEGRAM_CHAT_ID=${chatId}`;
  const updated = /^TELEGRAM_CHAT_ID=.*$/m.test(text)
    ? text.replace(/^TELEGRAM_CHAT_ID=.*$/m, line)
    : `${text.trimEnd()}\n${line}\n`;
  await writeFile(envPath, updated, { mode: 0o600 });
  await chmod(envPath, 0o600);
}

try {
  const [command, ...args] = process.argv.slice(2);

  if (command === 'telegram:setup') {
    process.exitCode = await runTelegramSetup(args, process.env, { print: console.log, saveChat });
  } else {
    console.error('Usage: cli telegram:setup [--find-chat | --test | --info | --replace]');
    process.exitCode = 1;
  }
} catch {
  console.error('Telegram setup failed. Check the hub configuration and Telegram connectivity.');
  process.exitCode = 1;
}
