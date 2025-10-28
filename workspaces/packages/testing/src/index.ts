// TODO: revisit this errors package and rework (look at config package)

export function withEnv<T>(env: Record<string, string>, run: () => T): T {
  const prev = process.env;
  process.env = { ...process.env, ...env } as NodeJS.ProcessEnv;
  try {
    return run();
  } finally {
    process.env = prev;
  }
}
