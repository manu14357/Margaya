import type { TokenUsage } from "./types";

// List prices in US dollars per million tokens. A dollar per million tokens
// is exactly one micro-dollar per token, so cost in micros is tokens times
// price. Models not listed (OpenAI-compatible, local) cost 0 in the ledger;
// their tokens are still counted.

type Price = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Prompts longer than this many input tokens use `long`. */
  longAbove?: number;
  long?: Omit<Price, "longAbove" | "long">;
};

const PRICES: Record<string, Price> = {
  "claude-haiku-5-5": {
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
    cacheWrite: 0.125,
    longAbove: 100_000,
    long: { input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 },
  },
  "claude-sonnet-5-5": {
    input: 2,
    output: 10,
    cacheRead: 0.2,
    cacheWrite: 2.5,
  },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-fable-5-1": {
    input: 10,
    output: 50,
    cacheRead: 0.25,
    cacheWrite: 12.5,
  },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  // Common embedding models (input only).
  "text-embedding-3-small": {
    input: 0.02,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  },
  "text-embedding-3-large": {
    input: 0.13,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  },
};

export function priceOf(model: string): Price | null {
  return PRICES[model] ?? null;
}

/** Cost of one call in micro-dollars, rounded up. */
export function costMicros(model: string, usage: TokenUsage): number {
  const base = priceOf(model);
  if (!base) return 0;
  const price =
    base.long &&
    base.longAbove !== undefined &&
    usage.input + usage.cacheRead + usage.cacheWrite > base.longAbove
      ? base.long
      : base;
  const micros =
    usage.input * price.input +
    usage.output * price.output +
    usage.cacheRead * price.cacheRead +
    usage.cacheWrite * price.cacheWrite;
  return Math.ceil(micros);
}
