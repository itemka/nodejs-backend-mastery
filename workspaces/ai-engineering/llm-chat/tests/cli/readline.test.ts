import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { createReadlineInput } from '../../src/cli/readline.js';

function createDiscardOutput(): Writable {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
}

describe('createReadlineInput', () => {
  it('reads a line from the configured input stream', async () => {
    const input = new PassThrough();
    const readlineInput = createReadlineInput({
      input,
      output: createDiscardOutput(),
    });

    const answer = readlineInput.ask('> ');
    input.write('Hello\n');

    await expect(answer).resolves.toBe('Hello');

    readlineInput.close();
  });

  it('rejects a pending question when stdin reaches EOF', async () => {
    const input = new PassThrough();
    const readlineInput = createReadlineInput({
      input,
      output: createDiscardOutput(),
    });

    const answer = readlineInput.ask('> ');
    input.push(null);

    await expect(answer).rejects.toThrow('Readline input closed');
  });
});
