import 'dotenv/config';
import { spawn } from 'node:child_process';
import process from 'node:process';

const configuredApiBaseUrl = normalizeOptionalEnvironmentValue(process.env.VITE_API_BASE_URL);
const developmentApiOrigin =
  normalizeOptionalEnvironmentValue(process.env.VITE_DEV_API_ORIGIN) ?? 'http://localhost:4000';
const pollIntervalMs = 150;
const readinessTimeoutMs = 15_000;

if (!configuredApiBaseUrl) {
  const readinessUrl = new URL('/api/health', developmentApiOrigin);

  await waitForApiReadiness(readinessUrl, readinessTimeoutMs, pollIntervalMs);
}

const child = spawn('pnpm', ['client:dev:vite'], {
  cwd: process.cwd(),
  shell: process.platform === 'win32',
  stdio: 'inherit',
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    child.kill(signal);
  });
}

child.on('exit', (code) => {
  process.exitCode = code ?? 0;
});

async function waitForApiReadiness(readinessUrl, timeoutMs, intervalMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const remainingTimeoutMs = deadline - Date.now();

    if (remainingTimeoutMs <= 0) {
      break;
    }

    if (await isApiReady(readinessUrl, remainingTimeoutMs)) {
      return;
    }

    await sleep(Math.min(intervalMs, Math.max(deadline - Date.now(), 0)));
  }

  console.warn(
    `[client:dev] Backend did not become ready at ${readinessUrl.origin} within ${timeoutMs}ms. Starting Vite anyway.`,
  );
}

async function isApiReady(readinessUrl, timeoutMs) {
  try {
    const response = await fetch(readinessUrl, {
      headers: {
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    return response.ok || response.status === 503;
  } catch {
    return false;
  }
}

async function sleep(milliseconds) {
  await new Promise((resolve) => {
    globalThis.setTimeout(resolve, milliseconds);
  });
}

function normalizeOptionalEnvironmentValue(value) {
  const normalizedValue = value?.trim();

  return normalizedValue || undefined;
}
