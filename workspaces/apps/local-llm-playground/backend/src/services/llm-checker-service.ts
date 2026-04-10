import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

import type { RecommendationCategory } from '../../../shared/api.js';
import { AppError } from '../lib/app-error.js';

interface CachedCommandResult {
  command: string[];
  durationMs: number;
  stderr: string;
  stdout: string;
}

type CommandInput =
  | { kind: 'check' }
  | { kind: 'installed' }
  | { kind: 'ollama-plan' }
  | { category: RecommendationCategory; kind: 'recommend' };

const cacheTtlMs = 5 * 60 * 1000;
const maxOutputBytes = 512 * 1024;
const require = createRequire(import.meta.url);
const llmCheckerCliPath = path.join(
  path.dirname(require.resolve('llm-checker/package.json')),
  'bin',
  'cli.js',
);

export function buildLlmCheckerCommand(input: CommandInput): string[] {
  switch (input.kind) {
    case 'check': {
      return ['check', '--ollama-only', '--use-case', 'general', '-l', '10', '--no-verbose'];
    }

    case 'installed': {
      return ['installed'];
    }

    case 'ollama-plan': {
      return ['ollama-plan', '--ctx', '8192', '--concurrency', '2', '--objective', 'balanced'];
    }

    case 'recommend': {
      return [
        'recommend',
        '--category',
        input.category,
        '--optimize',
        mapCategoryToOptimizationProfile(input.category),
        '--no-verbose',
      ];
    }
  }
}

export function buildLlmCheckerEnv(
  input: NodeJS.ProcessEnv,
  ollamaBaseUrl: string,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const trustedPath = buildTrustedPath(platform, input.SystemRoot);

  return {
    ...input,
    FORCE_COLOR: '0',
    OLLAMA_BASE_URL: ollamaBaseUrl,
    PATH: trustedPath,
    ...(platform === 'win32' ? { Path: trustedPath } : {}),
  };
}

export function isLlmCheckerFailureOutput(stdout: string, stderr: string): boolean {
  const combinedOutput = `${stdout}\n${stderr}`;

  return (
    combinedOutput.includes('Ollama not responding properly') ||
    combinedOutput.includes('Ollama not available')
  );
}

export class LlmCheckerService {
  private readonly cache = new Map<string, { expiresAt: number; value: CachedCommandResult }>();
  private readonly inFlight = new Map<string, Promise<CachedCommandResult>>();

  public constructor(
    private readonly timeoutMs: number,
    private readonly ollamaBaseUrl: string,
  ) {}

  public runCheck(signal?: AbortSignal): Promise<CachedCommandResult & { cached: boolean }> {
    return this.run({ kind: 'check' }, signal);
  }

  public runInstalled(signal?: AbortSignal): Promise<CachedCommandResult & { cached: boolean }> {
    return this.run({ kind: 'installed' }, signal);
  }

  public runOllamaPlan(signal?: AbortSignal): Promise<CachedCommandResult & { cached: boolean }> {
    return this.run({ kind: 'ollama-plan' }, signal);
  }

  public runRecommend(
    category: RecommendationCategory,
    signal?: AbortSignal,
  ): Promise<CachedCommandResult & { cached: boolean }> {
    return this.run({ category, kind: 'recommend' }, signal);
  }

  private async run(
    input: CommandInput,
    signal?: AbortSignal,
  ): Promise<CachedCommandResult & { cached: boolean }> {
    const llmCheckerArgs = buildLlmCheckerCommand(input);
    const cacheKey = llmCheckerArgs.join(' ');
    const cached = this.cache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      return {
        ...cached.value,
        cached: true,
      };
    }

    if (signal) {
      const result = await this.execute(llmCheckerArgs, signal);

      this.cache.set(cacheKey, {
        expiresAt: Date.now() + cacheTtlMs,
        value: result,
      });

      return {
        ...result,
        cached: false,
      };
    }

    const existingRun = this.inFlight.get(cacheKey);

    if (existingRun) {
      const result = await existingRun;

      return {
        ...result,
        cached: false,
      };
    }

    const runPromise = this.execute(llmCheckerArgs);
    this.inFlight.set(cacheKey, runPromise);

    try {
      const result = await runPromise;

      this.cache.set(cacheKey, {
        expiresAt: Date.now() + cacheTtlMs,
        value: result,
      });

      return {
        ...result,
        cached: false,
      };
    } finally {
      this.inFlight.delete(cacheKey);
    }
  }

  private async execute(
    llmCheckerArgs: string[],
    signal?: AbortSignal,
  ): Promise<CachedCommandResult> {
    const command = [process.execPath, llmCheckerCliPath, ...llmCheckerArgs];
    const executablePath = process.execPath;
    const executableArgs = [llmCheckerCliPath, ...llmCheckerArgs];
    const startedAt = performance.now();

    if (signal?.aborted) {
      throw createAbortError();
    }

    return await new Promise<CachedCommandResult>((resolve, reject) => {
      const child: ChildProcessWithoutNullStreams = spawn(executablePath, executableArgs, {
        cwd: process.cwd(),
        env: buildLlmCheckerEnv(process.env, this.ollamaBaseUrl),
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];
      let stdoutSize = 0;
      let stderrSize = 0;
      let settled = false;
      let terminationTimeout: NodeJS.Timeout | undefined;

      const cleanup = (): void => {
        clearTimeout(timeout);

        if (terminationTimeout) {
          clearTimeout(terminationTimeout);
        }

        signal?.removeEventListener('abort', onAbort);
      };

      const finalizeReject = (error: Error): void => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        reject(error);
      };

      const finalizeResolve = (result: CachedCommandResult): void => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        resolve(result);
      };

      const scheduleForcedTermination = (): void => {
        terminationTimeout = setTimeout(() => {
          if (child.exitCode === null) {
            child.kill('SIGKILL');
          }
        }, 5000);

        terminationTimeout.unref();
      };

      child.stdout.on('data', (chunk: Buffer) => {
        if (stdoutSize > maxOutputBytes) {
          return;
        }

        const text = String(chunk);
        stdoutSize += text.length;

        if (stdoutSize <= maxOutputBytes) {
          stdoutChunks.push(text);
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        if (stderrSize > maxOutputBytes) {
          return;
        }

        const text = String(chunk);
        stderrSize += text.length;

        if (stderrSize <= maxOutputBytes) {
          stderrChunks.push(text);
        }
      });

      child.on('error', (error: Error) => {
        finalizeReject(
          new AppError({
            cause: error,
            code: 'LLM_CHECKER_EXECUTION_FAILED',
            details: {
              command,
            },
            message: 'Failed to start llm-checker.',
            statusCode: 500,
          }),
        );
      });

      const onAbort = (): void => {
        child.kill('SIGTERM');
        scheduleForcedTermination();
        finalizeReject(createAbortError());
      };

      signal?.addEventListener('abort', onAbort, { once: true });

      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        scheduleForcedTermination();

        finalizeReject(
          new AppError({
            code: 'LLM_CHECKER_TIMEOUT',
            details: {
              command,
              timeoutMs: this.timeoutMs,
            },
            message: 'llm-checker took too long to finish.',
            statusCode: 504,
          }),
        );
      }, this.timeoutMs);

      timeout.unref();

      child.on('close', (exitCode: number | null) => {
        if (settled) {
          cleanup();

          return;
        }

        const stdout = stdoutChunks.join('');
        const stderr = stderrChunks.join('');

        if (isLlmCheckerFailureOutput(stdout, stderr)) {
          finalizeReject(
            new AppError({
              code: 'LLM_CHECKER_FAILED',
              details: {
                command,
                exitCode,
                stderr,
                stdout,
              },
              message: 'llm-checker could not reach Ollama.',
              statusCode: 502,
            }),
          );

          return;
        }

        if (exitCode !== 0) {
          finalizeReject(
            new AppError({
              code: 'LLM_CHECKER_FAILED',
              details: {
                command,
                exitCode,
                stderr,
                stdout,
              },
              message: 'llm-checker exited with a non-zero status code.',
              statusCode: 502,
            }),
          );

          return;
        }

        finalizeResolve({
          command,
          durationMs: Math.round(performance.now() - startedAt),
          stderr,
          stdout,
        });
      });
    });
  }
}

function createAbortError(): Error {
  const error = new Error('The request was aborted before completion.');
  error.name = 'AbortError';

  return error;
}

function buildTrustedPath(platform: NodeJS.Platform, systemRoot?: string): string {
  if (platform === 'win32') {
    const trimmedSystemRoot = systemRoot?.trim();
    const resolvedSystemRoot =
      trimmedSystemRoot && trimmedSystemRoot.length > 0
        ? trimmedSystemRoot
        : String.raw`C:\Windows`;

    return [
      path.join(resolvedSystemRoot, 'System32'),
      resolvedSystemRoot,
      path.join(resolvedSystemRoot, 'System32', 'Wbem'),
      path.join(resolvedSystemRoot, 'System32', 'WindowsPowerShell', 'v1.0'),
    ].join(';');
  }

  return ['/usr/bin', '/bin', '/usr/sbin', '/sbin', '/usr/local/bin'].join(':');
}

function mapCategoryToOptimizationProfile(category: RecommendationCategory): string {
  if (category === 'coding') {
    return 'coding';
  }

  if (category === 'reasoning') {
    return 'quality';
  }

  return 'balanced';
}
