import { AiError } from "../ai/errors";
import {
  type AiInstanceConfig,
  getAiInstanceConfig,
  webSearchConfigured,
} from "../ai/instance-config";
import { loadWorkspaceAiPolicy } from "../ai/workspace-settings";
import { assertPublicDestination } from "../utils/assert-public-destination";
import { createRateLimiter } from "../utils/rate-limit";

// Web search for Ask and agents, through the search provider the instance
// configured (ai.webSearch.*): a SearXNG server, Brave Search or Tavily.
// Only the query leaves Margaya, never workspace content: callers pass the
// person's own question (or an agent's query), not context. Each workspace
// opts in (workspace_ai_setting.web_search_enabled).

export type WebSearchResult = { title: string; url: string; snippet: string };

export const DEFAULT_WEB_RESULTS = 5;
export const MAX_WEB_RESULTS = 10;
export const MAX_WEB_QUERY_CHARS = 400;
const MAX_TITLE_CHARS = 200;
const MAX_SNIPPET_CHARS = 600;
const TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 2_000_000;

const BRAVE_URL = "https://api.search.brave.com/res/v1/web/search";
const TAVILY_URL = "https://api.tavily.com/search";

const limiter = createRateLimiter({
  name: "ai-web-search",
  windowSeconds: 60,
  max: () => {
    const value = Number(process.env.MARGAYA_AI_WEB_SEARCH_RPM);
    return Number.isInteger(value) && value >= 0 ? value : 60;
  },
});

let fetchImpl: typeof fetch = (...args) => fetch(...args);

/** Replaces the HTTP client (tests); null restores fetch. */
export function setWebSearchFetch(next: typeof fetch | null): void {
  fetchImpl = next ?? ((...args) => fetch(...args));
}

/** Whether web search may run for a workspace (instance and workspace on). */
export async function webSearchAllowed(
  workspaceId: string,
  config: AiInstanceConfig = getAiInstanceConfig(),
): Promise<boolean> {
  if (!webSearchConfigured(config)) return false;
  return (await loadWorkspaceAiPolicy(workspaceId)).webSearchEnabled;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
};

/** Plain, single-line text: no tags, entities decoded, bounded. */
export function cleanWebText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#?\w+);/g, (match, name: string) => ENTITIES[name] ?? match)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function httpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/** Normalizes one provider's results; drops entries without a usable URL. */
export function normalizeWebResults(
  rows: readonly { title?: unknown; url?: unknown; snippet?: unknown }[],
  max: number,
): WebSearchResult[] {
  const seen = new Set<string>();
  const out: WebSearchResult[] = [];
  for (const row of rows) {
    const url = httpUrl(row.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({
      title: cleanWebText(row.title, MAX_TITLE_CHARS) || url,
      url,
      snippet: cleanWebText(row.snippet, MAX_SNIPPET_CHARS),
    });
    if (out.length >= max) break;
  }
  return out;
}

async function readJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (declared > MAX_RESPONSE_BYTES) throw new Error("too large");
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) throw new Error("too large");
  return JSON.parse(text) as unknown;
}

type Row = { title?: unknown; url?: unknown; snippet?: unknown };

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null,
      )
    : [];
}

async function searxng(
  base: string,
  query: string,
  signal: AbortSignal,
): Promise<Row[]> {
  const url = new URL(`${base.replace(/\/+$/, "")}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("safesearch", "1");
  // The operator's URL could point anywhere: the usual outbound guard.
  await assertPublicDestination(url.toString(), "Web search");
  const response = await fetchImpl(url, {
    headers: { accept: "application/json" },
    signal,
    redirect: "error",
  });
  if (!response.ok) throw new Error(`status ${response.status}`);
  const body = (await readJson(response)) as { results?: unknown };
  return list(body.results).map((row) => ({
    title: row.title,
    url: row.url,
    snippet: row.content,
  }));
}

async function brave(
  apiKey: string,
  query: string,
  max: number,
  signal: AbortSignal,
): Promise<Row[]> {
  const url = new URL(BRAVE_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(max));
  url.searchParams.set("safesearch", "moderate");
  const response = await fetchImpl(url, {
    headers: { accept: "application/json", "x-subscription-token": apiKey },
    signal,
    redirect: "error",
  });
  if (!response.ok) throw new Error(`status ${response.status}`);
  const body = (await readJson(response)) as { web?: { results?: unknown } };
  return list(body.web?.results).map((row) => ({
    title: row.title,
    url: row.url,
    snippet: row.description,
  }));
}

async function tavily(
  apiKey: string,
  query: string,
  max: number,
  signal: AbortSignal,
): Promise<Row[]> {
  const response = await fetchImpl(TAVILY_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      max_results: max,
      search_depth: "basic",
      include_answer: false,
    }),
    signal,
    redirect: "error",
  });
  if (!response.ok) throw new Error(`status ${response.status}`);
  const body = (await readJson(response)) as { results?: unknown };
  return list(body.results).map((row) => ({
    title: row.title,
    url: row.url,
    snippet: row.content,
  }));
}

/**
 * Searches the web with the instance's provider. Throws AI_NOT_CONFIGURED
 * without a provider, AI_DISABLED when the workspace has web search off,
 * AI_RATE_LIMITED past the per-workspace rate, and AI_PROVIDER_ERROR when the
 * provider fails (its response text never reaches the caller or the log).
 */
export async function webSearch(input: {
  query: string;
  workspaceId: string;
  max?: number;
  signal?: AbortSignal;
}): Promise<WebSearchResult[]> {
  const config = getAiInstanceConfig();
  if (!webSearchConfigured(config)) {
    throw new AiError("AI_NOT_CONFIGURED", "Web search is not set up");
  }
  const policy = await loadWorkspaceAiPolicy(input.workspaceId);
  if (!policy.webSearchEnabled) {
    throw new AiError(
      "AI_DISABLED",
      "Web search is turned off for this workspace",
    );
  }
  const query = input.query
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_WEB_QUERY_CHARS);
  if (!query) return [];
  const decision = await limiter.consume(input.workspaceId);
  if (decision && !decision.allowed) {
    throw new AiError("AI_RATE_LIMITED", "Too many web searches", {
      retryAfterSeconds: decision.retryAfter,
    });
  }
  const max = Math.min(
    Math.max(1, Math.floor(input.max ?? DEFAULT_WEB_RESULTS)),
    MAX_WEB_RESULTS,
  );
  const signal = AbortSignal.any([
    AbortSignal.timeout(TIMEOUT_MS),
    ...(input.signal ? [input.signal] : []),
  ]);
  const { provider, url, apiKey } = config.webSearch;
  try {
    const rows =
      provider === "searxng"
        ? await searxng(url, query, signal)
        : provider === "brave"
          ? await brave(apiKey, query, max, signal)
          : await tavily(apiKey, query, max, signal);
    return normalizeWebResults(rows, max);
  } catch (error) {
    if (input.signal?.aborted) throw error;
    // The kind only: provider errors may echo the query or the key.
    console.error("Web search failed", {
      provider,
      error: error instanceof Error ? error.name : "unknown",
    });
    throw new AiError(
      "AI_PROVIDER_ERROR",
      signal.aborted ? "Web search timed out" : "Web search failed",
    );
  }
}
