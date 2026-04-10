import type { Dispatch, SetStateAction } from 'react';
import { useEffect, useState } from 'react';

import { readStorageValue, writeStorageValue } from '../lib/storage.js';

export function usePersistentState<T>(
  key: string,
  initialValue: T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => readStorageValue(key, initialValue));

  useEffect(() => {
    writeStorageValue(key, value);
  }, [key, value]);

  return [value, setValue];
}
