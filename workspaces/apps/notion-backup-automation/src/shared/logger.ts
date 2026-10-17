import type { Clock } from './clock.js';
import { systemClock } from './clock.js';
import { redact } from './redact.js';

export const logLevels = ['debug', 'info', 'warn', 'error'] as const;

export type LogLevel = (typeof logLevels)[number];

export type LogFields = Readonly<Record<string, unknown>>;

/** Structured JSON-line logger. Every line goes through `redact`; there is no way around it. */
export interface Logger {
  child(bindings: LogFields): Logger;
  debug(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
}

export type LogSink = (level: LogLevel, line: string) => void;

export interface LoggerOptions {
  /** Fields added to every line, such as `jobId`, `period` and `tickId`. */
  bindings?: LogFields;
  clock?: Clock;
  level?: LogLevel;
  sink?: LogSink;
}

const writeToStdio: LogSink = (level, line) => {
  const stream = level === 'warn' || level === 'error' ? process.stderr : process.stdout;

  stream.write(`${line}\n`);
};

export function createLogger(options: LoggerOptions = {}): Logger {
  const { bindings = {}, clock = systemClock, level = 'info', sink = writeToStdio } = options;
  const threshold = logLevels.indexOf(level);

  const write = (lineLevel: LogLevel, event: string, fields: LogFields = {}): void => {
    if (logLevels.indexOf(lineLevel) < threshold) {
      return;
    }

    // The fixed keys come first and, spread last, cannot be overridden by bindings or fields.
    const header = { event, level: lineLevel, time: clock.now().toISOString() };
    const record = { ...header, ...bindings, ...fields, ...header };

    sink(lineLevel, JSON.stringify(redact(record)));
  };

  return {
    child: (extra) => createLogger({ bindings: { ...bindings, ...extra }, clock, level, sink }),
    debug: (event, fields) => {
      write('debug', event, fields);
    },
    error: (event, fields) => {
      write('error', event, fields);
    },
    info: (event, fields) => {
      write('info', event, fields);
    },
    warn: (event, fields) => {
      write('warn', event, fields);
    },
  };
}
