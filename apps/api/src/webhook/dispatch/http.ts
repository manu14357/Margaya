import { assertPublicDestination } from "../../utils/assert-public-destination";
import { withoutOutboundTelemetry } from "../../utils/sensitive-outbound";
import { MAX_RESPONSE_SNIPPET_BYTES } from "../types";

// One webhook request (B13a §3.1 http.ts). The destination is checked again
// before every attempt, redirects are never followed, the response body is
// read only up to 2 KB, and errors never carry the URL or raw exception text.

export type WebhookFailureKind = "timeout" | "network" | "destination";

export class WebhookSendError extends Error {
  constructor(readonly kind: WebhookFailureKind) {
    super(`Webhook request failed: ${kind}`);
    this.name = "WebhookSendError";
  }
}

export type WebhookResponse = {
  status: number;
  snippet: string;
  retryAfter: string | null;
  durationMs: number;
};

/** Mutable so tests can shorten the timeout instead of waiting 10 s. */
export const webhookHttpLimits = { timeoutMs: 10_000 };

// Control characters other than tab and newline.
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point.
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

/** The first 2 KB of a body as text, without control characters. */
export function responseSnippet(bytes: Uint8Array): string {
  const head = bytes.subarray(0, MAX_RESPONSE_SNIPPET_BYTES);
  return new TextDecoder("utf-8", { fatal: false })
    .decode(head)
    .replace(CONTROL_CHARACTERS, "");
}

async function readHead(response: Response, signal: AbortSignal) {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < MAX_RESPONSE_SNIPPET_BYTES && !signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
    }
  } catch {
    // A body that breaks off still leaves the status code.
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * POSTs `body` with `headers`. Resolves with the status, a body snippet and
 * Retry-After for any HTTP answer (3xx included: redirects are reported, not
 * followed); throws `WebhookSendError` for a blocked destination, a network
 * failure or the timeout.
 */
export async function postWebhook(
  url: string,
  headers: Record<string, string>,
  body: string,
): Promise<WebhookResponse> {
  const started = Date.now();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The deadline also covers the DNS check, which takes no abort signal.
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new WebhookSendError("timeout"));
    }, webhookHttpLimits.timeoutMs);
  });
  const attempt = async (): Promise<WebhookResponse> => {
    try {
      await assertPublicDestination(url, "Webhook");
    } catch {
      throw new WebhookSendError("destination");
    }
    // A late DNS answer must never start a request after the deadline.
    if (controller.signal.aborted) throw new WebhookSendError("timeout");
    let response: Response;
    try {
      response = await withoutOutboundTelemetry(() =>
        fetch(url, {
          method: "POST",
          headers,
          body,
          redirect: "manual",
          signal: controller.signal,
        }),
      );
    } catch {
      throw new WebhookSendError(
        controller.signal.aborted ? "timeout" : "network",
      );
    }
    const bytes = await readHead(response, controller.signal);
    return {
      status: response.status,
      snippet: responseSnippet(bytes),
      retryAfter: response.headers.get("retry-after"),
      durationMs: Date.now() - started,
    };
  };
  try {
    return await Promise.race([attempt(), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
