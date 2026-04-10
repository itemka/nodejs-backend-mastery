export function readStorageValue<T>(key: string, fallbackValue: T): T {
  if (globalThis.window === undefined) {
    return fallbackValue;
  }

  try {
    const rawValue = globalThis.localStorage.getItem(key);

    if (!rawValue) {
      return fallbackValue;
    }

    const parsed: unknown = JSON.parse(rawValue);

    if (
      typeof parsed !== typeof fallbackValue ||
      parsed === null ||
      Array.isArray(parsed) !== Array.isArray(fallbackValue)
    ) {
      return fallbackValue;
    }

    if (typeof fallbackValue === 'object' && fallbackValue !== null) {
      const knownKeys = Object.keys(fallbackValue as Record<string, unknown>);
      const parsedRecord = parsed as Record<string, unknown>;
      const merged = { ...fallbackValue } as Record<string, unknown>;

      for (const key of knownKeys) {
        if (key in parsedRecord) {
          merged[key] = parsedRecord[key];
        }
      }

      return merged as T;
    }

    return parsed as T;
  } catch {
    return fallbackValue;
  }
}

export function writeStorageValue<T>(key: string, value: T): void {
  if (globalThis.window === undefined) {
    return;
  }

  globalThis.localStorage.setItem(key, JSON.stringify(value));
}
