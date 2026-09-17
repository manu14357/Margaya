// The public task list cache (B12 K6, §3.7): in process, 500 entries, 10 s.
// The board is resolved before every lookup, so unpublishing, rotating or
// switching boards off takes effect at once; the key includes the
// publication's version, so a settings change misses the cache.

const MAX_ENTRIES = 500;
const TTL_MS = 10_000;

type Entry = { value: unknown; expiresAt: number };

const entries = new Map<string, Entry>();

export function boardListCacheKey(
  token: string,
  version: Date,
  query: Record<string, unknown>,
): string {
  const normalized = Object.keys(query)
    .sort()
    .filter((key) => query[key] !== undefined && query[key] !== "")
    .map((key) => [key, query[key]]);
  return `${token}:${version.getTime()}:${JSON.stringify(normalized)}`;
}

export function readBoardListCache<T>(key: string, now = Date.now()): T | null {
  const entry = entries.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    entries.delete(key);
    return null;
  }
  // Least recently used goes last: re-insert on every hit.
  entries.delete(key);
  entries.set(key, entry);
  return entry.value as T;
}

export function writeBoardListCache(
  key: string,
  value: unknown,
  now = Date.now(),
) {
  entries.delete(key);
  entries.set(key, { value, expiresAt: now + TTL_MS });
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
}

/** Test hook. */
export function clearBoardListCache() {
  entries.clear();
}
