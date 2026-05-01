import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline';

export interface InputAdapter {
  ask(prompt: string): Promise<string>;
  close(): void;
}

export function createReadlineInput(): InputAdapter {
  const readline = createInterface({ input: stdin, output: stdout });

  return {
    ask(prompt) {
      return new Promise<string>((resolve) => {
        readline.question(prompt, resolve);
      });
    },
    close() {
      readline.close();
    },
  };
}
