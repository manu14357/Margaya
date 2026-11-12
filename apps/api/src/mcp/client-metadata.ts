import { z } from "zod";
import { assertPublicDestination } from "../utils/assert-public-destination";
import { withoutOutboundTelemetry } from "../utils/sensitive-outbound";
import { isValidRedirectUri } from "./redirect-uri";

// OAuth Client ID Metadata Documents (MCP 2026-07-28, draft-ietf-oauth-
// client-id-metadata-document): a client may use an HTTPS URL as its
// client_id, and that URL serves the client's metadata. Margaya fetches the
// document when such a client starts an authorization, checks that it names
// itself and lists the redirect URI, and caches it briefly. Dynamic Client
// Registration keeps working for older clients.

export const CLIENT_METADATA_MAX_URL = 2048;
// The draft suggests 5 KB; real documents are far smaller.
const MAX_DOCUMENT_BYTES = 5 * 1024;
const FETCH_TIMEOUT_MS = 5_000;
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MIN_TTL_MS = 60 * 1000;
const MAX_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHED = 500;

export type MetadataClient = {
  clientId: string;
  redirectUris: string[];
  clientName?: string;
  /** The host that published the document, shown on the consent page. */
  metadataHost: string;
  issuedAt: number;
};

/** Thrown when a URL client_id can't be used; the reason stays server-side. */
export class ClientMetadataError extends Error {
  constructor(readonly reason: string) {
    super(`Client metadata document rejected: ${reason}`);
    this.name = "ClientMetadataError";
  }
}

/**
 * Whether a client_id is a Client ID Metadata Document URL: https, with a
 * path, and no fragment, credentials or dot segments.
 */
export function isClientMetadataUrl(value: string): boolean {
  if (value.length > CLIENT_METADATA_MAX_URL || !value.startsWith("https://")) {
    return false;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    if (url.hash || url.username || url.password) return false;
    if (url.pathname === "/" || url.pathname === "") return false;
    // The URL must already be in its normal form: the client_id comparison
    // is a plain string match, and dot segments would hide the real path.
    if (url.href !== value) return false;
    return !url.pathname
      .split("/")
      .some((segment) => segment === "." || segment === "..");
  } catch {
    return false;
  }
}

const documentSchema = z.looseObject({
  client_id: z.string(),
  client_name: z.string().trim().min(1).max(100),
  redirect_uris: z
    .array(z.string().max(2048).refine(isValidRedirectUri))
    .min(1)
    .max(10),
  token_endpoint_auth_method: z.literal("none").optional(),
  grant_types: z
    .array(z.string())
    .max(5)
    .refine((types) => types.includes("authorization_code"))
    .optional(),
  response_types: z
    .array(z.string())
    .max(3)
    .refine((types) => types.includes("code"))
    .optional(),
});

type CacheEntry = { client: MetadataClient; expiresAt: number };
const cache = new Map<string, CacheEntry>();

export function clearClientMetadataCache(): void {
  cache.clear();
}

/** How long to keep a document: its Cache-Control max-age, within bounds. */
export function cacheTtlMs(cacheControl: string | null): number {
  if (cacheControl && /\b(no-store|no-cache)\b/i.test(cacheControl)) {
    return MIN_TTL_MS;
  }
  const maxAge = cacheControl?.match(/\bmax-age=(\d+)/i)?.[1];
  if (!maxAge) return DEFAULT_TTL_MS;
  return Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, Number(maxAge) * 1000));
}

async function readBounded(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new ClientMetadataError("empty response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_DOCUMENT_BYTES) {
        throw new ClientMetadataError("document too large");
      }
      chunks.push(value);
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

async function fetchDocument(
  url: string,
): Promise<{ body: string; cacheControl: string | null }> {
  try {
    await assertPublicDestination(url, "Client metadata");
  } catch {
    throw new ClientMetadataError("destination not allowed");
  }
  let response: Response;
  try {
    response = await withoutOutboundTelemetry(() =>
      fetch(url, {
        method: "GET",
        headers: { accept: "application/json" },
        // A redirect could point anywhere, including inside the network.
        redirect: "error",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      }),
    );
  } catch {
    throw new ClientMetadataError("fetch failed");
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new ClientMetadataError(`HTTP ${response.status}`);
  }
  const type = response.headers.get("content-type") ?? "";
  if (!/^application\/([\w.+-]+\+)?json\b/i.test(type)) {
    void response.body?.cancel().catch(() => {});
    throw new ClientMetadataError("not JSON");
  }
  return {
    body: await readBounded(response),
    cacheControl: response.headers.get("cache-control"),
  };
}

/** Validates a fetched document against the URL it came from. */
export function parseClientMetadata(
  url: string,
  body: string,
): Omit<MetadataClient, "issuedAt"> {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new ClientMetadataError("invalid JSON");
  }
  const parsed = documentSchema.safeParse(json);
  if (!parsed.success) throw new ClientMetadataError("invalid document");
  const doc = parsed.data;
  // The document must name itself exactly.
  if (doc.client_id !== url)
    throw new ClientMetadataError("client_id mismatch");
  // Public clients only: a document must not carry a shared secret.
  if ("client_secret" in doc || "client_secret_expires_at" in doc) {
    throw new ClientMetadataError("client secrets are not allowed");
  }
  return {
    clientId: url,
    redirectUris: [...new Set(doc.redirect_uris)],
    clientName: doc.client_name,
    metadataHost: new URL(url).host,
  };
}

/**
 * The client a metadata URL describes, fetched or from the cache. Throws
 * ClientMetadataError when the document can't be used.
 */
export async function resolveClientMetadata(
  url: string,
): Promise<MetadataClient> {
  if (!isClientMetadataUrl(url)) throw new ClientMetadataError("invalid URL");
  const cached = cache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.client;
  const { body, cacheControl } = await fetchDocument(url);
  const client: MetadataClient = {
    ...parseClientMetadata(url, body),
    issuedAt: Math.floor(Date.now() / 1000),
  };
  if (cache.size >= MAX_CACHED) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.delete(url);
  cache.set(url, { client, expiresAt: Date.now() + cacheTtlMs(cacheControl) });
  return client;
}
