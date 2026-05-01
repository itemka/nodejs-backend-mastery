import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline';

export interface InputAdapter {
  ask(prompt: string): Promise<string>;
  close(): void;
}

export interface ReadlineInputOptions {
  readonly input?: NodeJS.ReadableStream;
  readonly output?: NodeJS.WritableStream;
}

export function createReadlineInput(options: ReadlineInputOptions = {}): InputAdapter {
  const readline = createInterface({
    input: options.input ?? stdin,
    output: options.output ?? stdout,
  });
  let isClosed = false;
  let pendingReject: ((error: Error) => void) | undefined;

  readline.on('close', () => {
    isClosed = true;
    pendingReject?.(new Error('Readline input closed'));
    pendingReject = undefined;
  });

  return {
    ask(prompt) {
      if (isClosed) {
        return Promise.reject(new Error('Readline input closed'));
      }

      return new Promise<string>((resolve, reject) => {
        pendingReject = reject;
        readline.question(prompt, (answer) => {
          pendingReject = undefined;
          resolve(answer);
        });
      });
    },
    close() {
      readline.close();
    },
  };
}
