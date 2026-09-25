import { useEffect, useState } from 'react';

// localStorage can throw (private mode, blocked storage); treat it as best-effort.
export function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}

export function writeStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function useStored<T extends object>(key: string, fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => readStored(key, fallback));
  useEffect(() => writeStored(key, value), [key, value]);
  return [value, setValue];
}
