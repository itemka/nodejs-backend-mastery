import { inspect } from 'node:util';

import { REDACTED } from './redact.js';

/**
 * Holds a value that must never reach a log line, an error message or a tool result, such as
 * the signed export link. Serializing, printing or inspecting it shows only `[redacted]`; the
 * value comes out only through `reveal()`.
 */
export class SecretValue<T> {
  readonly #value: T;

  constructor(value: T) {
    this.#value = value;
  }

  [inspect.custom](): string {
    return `SecretValue(${REDACTED})`;
  }

  reveal(): T {
    return this.#value;
  }

  toJSON(): string {
    return REDACTED;
  }

  toString(): string {
    return REDACTED;
  }
}
