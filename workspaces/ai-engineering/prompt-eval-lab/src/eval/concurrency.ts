export async function runWithConcurrency<T, U>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<U>,
): Promise<U[]> {
  if (items.length === 0) {
    return [];
  }

  const effectiveLimit = Math.max(1, Math.min(limit, items.length));
  const results: U[] = Array.from({ length: items.length });
  let cursor = 0;

  async function consume(): Promise<void> {
    while (true) {
      const index = cursor++;

      if (index >= items.length) {
        return;
      }

      results[index] = await worker(items[index]!, index);
    }
  }

  await Promise.all(Array.from({ length: effectiveLimit }, () => consume()));

  return results;
}
