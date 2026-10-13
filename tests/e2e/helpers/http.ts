import {
  type APIRequestContext,
  type APIResponse,
  request,
} from "@playwright/test";

type StorageState = Awaited<ReturnType<APIRequestContext["storageState"]>>;

export type ApiContextOptions = {
  apiURL: string;
  /** Sent as Origin: Better Auth rejects cookie-bearing writes from unknown origins. */
  clientURL: string;
  storageState?: string | StorageState;
  extraHTTPHeaders?: Record<string, string>;
};

/**
 * An HTTP client for the public API. Paths are absolute from the API origin,
 * for example `/api/project?workspaceId=...` or `/api/auth/sign-in/email`.
 */
export function createApiContext({
  apiURL,
  clientURL,
  storageState,
  extraHTTPHeaders,
}: ApiContextOptions): Promise<APIRequestContext> {
  return request.newContext({
    baseURL: apiURL,
    storageState,
    extraHTTPHeaders: { Origin: clientURL, ...extraHTTPHeaders },
  });
}

export class ApiError extends Error {
  constructor(
    readonly what: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(`${what} failed with HTTP ${status}: ${body.slice(0, 500)}`);
  }
}

/** Parse a JSON response, throwing an ApiError with the body on non-2xx. */
export async function readJson<T>(
  response: APIResponse,
  what: string,
): Promise<T> {
  if (!response.ok()) {
    throw new ApiError(what, response.status(), await response.text());
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

/** Poll `url` until it answers with a status below 500. */
export async function waitForUrl(
  url: string,
  { timeoutMs = 120_000, intervalMs = 500 } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status < 500) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(
    `Timed out waiting for ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}
