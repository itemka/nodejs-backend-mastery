import 'dotenv/config';
import { spawn } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import process from 'node:process';

const configuredApiBaseUrl = normalizeOptionalEnvironmentValue(process.env.VITE_API_BASE_URL);
const developmentApiOrigin =
  normalizeOptionalEnvironmentValue(process.env.VITE_DEV_API_ORIGIN) ?? 'https://127.0.0.1:4000';
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
    const response = await requestReadinessResponse(readinessUrl, timeoutMs);

    response.resume();

    return (
      typeof response.statusCode === 'number' &&
      ((response.statusCode >= 200 && response.statusCode < 300) || response.statusCode === 503)
    );
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

function isLocalTlsOrigin(url) {
  return url.protocol === 'https:' && ['127.0.0.1', '::1', 'localhost'].includes(url.hostname);
}

function requestReadinessResponse(readinessUrl, timeoutMs) {
  return new Promise((resolve, reject) => {
    const client = readinessUrl.protocol === 'https:' ? https : http;
    const request = client.request(
      readinessUrl,
      {
        headers: {
          accept: 'application/json',
        },
        method: 'GET',
        rejectUnauthorized: !isLocalTlsOrigin(readinessUrl),
        signal: AbortSignal.timeout(timeoutMs),
      },
      (response) => {
        resolve(response);
      },
    );

    request.on('error', reject);

    request.end();
  });
}
