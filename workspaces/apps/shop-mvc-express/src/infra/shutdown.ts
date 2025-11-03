import type { Server } from 'node:http';

export function registerGracefulShutdown(
  server: Server,
  resources?: {
    closeAll?: () => Promise<void>; // External resources to close (e.g. db, redis, queues, etc.)
  },
) {
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals | 'CRASH') => {
    if (shuttingDown) return;

    shuttingDown = true;

    const start = Date.now();
    const pid = process.pid;
    const timeoutMs = 10_000;

    console.log(`\n[graceful] Received ${signal}. Starting shutdown... pid=${pid}`);

    const hard = setTimeout(() => {
      const elapsed = Date.now() - start;
      console.warn(
        `[graceful] Forcing shutdown after ${timeoutMs}ms. Exit 1 (forced-timeout): shutdown exceeded ${timeoutMs}ms (elapsed=${elapsed}ms, signal=${signal}, pid=${pid}, uptime=${process.uptime().toFixed(1)}s)`,
      );
      // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
      process.exit(1);
    }, timeoutMs);

    // unref() is used to prevent the process from exiting before the timeout is triggered.
    // if the process exits before the timeout is triggered, the timeout will be cancelled
    // and the process will exit without waiting for the timeout to complete.
    hard.unref();

    try {
      if (typeof server.closeIdleConnections === 'function') {
        server.closeIdleConnections();
      }

      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });

      await resources?.closeAll?.();

      const elapsed = Date.now() - start;

      console.log(
        `[graceful] Shutdown complete. Exit 0 (clean): shutdown complete in ${elapsed}ms (signal=${signal}, pid=${pid}, uptime=${process.uptime().toFixed(1)}s)`,
      );

      // Exit cleanly
      // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
      process.exit(0);
    } catch (error) {
      const elapsed = Date.now() - start;

      console.error(
        `[graceful] Shutdown failed. Exit 1 (shutdown-error): after ${elapsed}ms (signal=${signal}, pid=${pid}, uptime=${process.uptime().toFixed(1)}s)`,
      );
      console.error('[graceful] Error details:', error);
      // Non-zero exit on failure
      // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
      process.exit(1);
    } finally {
      clearTimeout(hard);
    }
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('uncaughtException', (error) => {
    console.error('[uncaughtException] Fatal error:', error);
    void shutdown('CRASH');
  });
  process.once('unhandledRejection', (reason) => {
    console.error('[unhandledRejection] Unhandled promise rejection:', reason);
    void shutdown('CRASH');
  });
}
