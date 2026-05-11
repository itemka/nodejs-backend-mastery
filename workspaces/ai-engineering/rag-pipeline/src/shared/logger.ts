type LogLevel = 'error' | 'info' | 'warn';

type LogContext = Record<string, unknown>;

export interface Logger {
  error(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
}

function writeLog(level: LogLevel, message: string, context: LogContext = {}): void {
  const payload = JSON.stringify({
    context,
    level,
    message,
    timestamp: new Date().toISOString(),
  });

  if (level === 'error') {
    console.error(payload);

    return;
  }

  console.log(payload);
}

export const logger: Logger = {
  error(message, context) {
    writeLog('error', message, context);
  },
  info(message, context) {
    writeLog('info', message, context);
  },
  warn(message, context) {
    writeLog('warn', message, context);
  },
};
