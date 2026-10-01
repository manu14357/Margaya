import { useCallback, useEffect, useState } from "react";

function read<T>(
  key: string,
  fallback: T,
  isValid: (value: unknown) => boolean,
) {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.localStorage.getItem(key);
    if (stored === null) return fallback;
    const parsed = JSON.parse(stored) as unknown;
    return isValid(parsed) ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * UI state kept in localStorage per key (open sections, a selected tab).
 * Unavailable or corrupt storage falls back to the default in memory.
 */
export function useStoredState<T>(
  key: string,
  fallback: T,
  isValid: (value: unknown) => boolean,
) {
  const [value, setValue] = useState<T>(() => read(key, fallback, isValid));

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-read only when the key changes
  useEffect(() => {
    setValue(read(key, fallback, isValid));
  }, [key]);

  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Storage may be unavailable or full; keep the value in memory.
      }
    },
    [key],
  );

  return [value, update] as const;
}

/** Validates stored open/closed flags, such as a list's section state. */
export function isBooleanRecord(
  value: unknown,
): value is Record<string, boolean> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((flag) => typeof flag === "boolean")
  );
}
