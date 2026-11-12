export const DEFAULT_DATABASE_POOL_MAX = 10;
// Generous on purpose: long exports and analytics queries must still finish,
// while a runaway query cannot hold a pool connection forever. Startup
// migrations run on their own connection without a limit.
export const DEFAULT_DATABASE_STATEMENT_TIMEOUT_MS = 5 * 60 * 1000;

export type DatabasePoolSettings = {
  max: number;
  /** 0 means no limit. */
  statementTimeoutMs: number;
};

type Env = Record<string, string | undefined>;

function readInteger(
  env: Env,
  name: string,
  fallback: number,
  min: number,
  warn: (message: string) => void,
): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    warn(
      `${name}="${raw}" is not a whole number of at least ${min}; using ${fallback}.`,
    );
    return fallback;
  }
  return value;
}

export function resolveDatabasePoolSettings(
  env: Env = process.env,
  warn: (message: string) => void = console.warn,
): DatabasePoolSettings {
  return {
    max: readInteger(
      env,
      "DATABASE_POOL_MAX",
      DEFAULT_DATABASE_POOL_MAX,
      1,
      warn,
    ),
    statementTimeoutMs: readInteger(
      env,
      "DATABASE_STATEMENT_TIMEOUT_MS",
      DEFAULT_DATABASE_STATEMENT_TIMEOUT_MS,
      0,
      warn,
    ),
  };
}
