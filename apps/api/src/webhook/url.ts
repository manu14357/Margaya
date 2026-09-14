import { HTTPException } from "hono/http-exception";
import { assertPublicWebhookDestination } from "../plugins/generic-webhook/config";

// Endpoint URLs (B13a §3.3). The path and query stay verbatim: receivers
// often carry tokens there. The resolved address is never echoed back.

export const INVALID_WEBHOOK_URL = "Enter a valid http or https URL";
export const WEBHOOK_URL_CREDENTIALS = "Remove credentials from the URL";
export const WEBHOOK_URL_PRIVATE =
  "This URL resolves to a private or unreachable address";
export const WEBHOOK_URL_SELF = "Webhooks can't point at this Margaya instance";

export class WebhookUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookUrlError";
  }
}

const DEFAULT_PORTS: Record<string, string> = {
  "http:": "80",
  "https:": "443",
};

function hostKey(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, "");
}

/**
 * Trims, lower-cases the scheme and host, drops the fragment and a default
 * port. Throws `WebhookUrlError` for anything but an absolute http(s) URL,
 * or a URL carrying a username or password.
 */
export function normalizeWebhookUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new WebhookUrlError(INVALID_WEBHOOK_URL);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new WebhookUrlError(INVALID_WEBHOOK_URL);
  }
  if (!url.hostname) throw new WebhookUrlError(INVALID_WEBHOOK_URL);
  if (url.username || url.password) {
    throw new WebhookUrlError(WEBHOOK_URL_CREDENTIALS);
  }
  // URL already lower-cases the scheme and host; the port check is explicit
  // because a non-special default port would survive.
  if (url.port === DEFAULT_PORTS[url.protocol]) url.port = "";
  url.hash = "";
  url.hostname = hostKey(url.hostname);
  return url.toString();
}

function effectivePort(url: URL): string {
  return url.port || DEFAULT_PORTS[url.protocol] || "";
}

/** host:port of this instance's API and web origins. */
function instanceHosts(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const hosts = new Set<string>();
  for (const raw of [env.MARGAYA_API_URL, env.MARGAYA_CLIENT_URL]) {
    if (!raw) continue;
    try {
      const url = new URL(raw);
      hosts.add(`${hostKey(url.hostname)}:${effectivePort(url)}`);
    } catch {
      // A malformed origin can't match anything.
    }
  }
  return hosts;
}

/** Whether the URL points at this Margaya instance's API or web origin. */
export function pointsAtInstance(
  normalizedUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const url = new URL(normalizedUrl);
  return instanceHosts(env).has(
    `${hostKey(url.hostname)}:${effectivePort(url)}`,
  );
}

/**
 * Normalizes and checks an endpoint for create and update: 400 with one
 * safe sentence when it is malformed, carries credentials, points at this
 * instance or resolves to a private or unresolvable address.
 */
export async function assertWebhookUrlAllowed(raw: string): Promise<string> {
  let normalized: string;
  try {
    normalized = normalizeWebhookUrl(raw);
  } catch (error) {
    throw new HTTPException(400, {
      message:
        error instanceof WebhookUrlError ? error.message : INVALID_WEBHOOK_URL,
    });
  }
  if (pointsAtInstance(normalized)) {
    throw new HTTPException(400, { message: WEBHOOK_URL_SELF });
  }
  try {
    await assertPublicWebhookDestination(normalized);
  } catch {
    throw new HTTPException(400, { message: WEBHOOK_URL_PRIVATE });
  }
  return normalized;
}
