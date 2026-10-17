import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import { isDisallowedAddress } from "./assert-public-destination";
import { withoutOutboundTelemetry } from "./sensitive-outbound";

// Reads a public web page's <title> for link previews. Strict on purpose:
// the URL comes from any task editor, so every hop is checked where the
// connection is made (the resolved address, not just the name), redirects
// are few and re-checked, and the read is small and short.

/** Mutable so tests can shorten them. */
export const pageTitleLimits = {
  timeoutMs: 3_000,
  maxBytes: 256 * 1024,
  maxRedirects: 3,
};

const ALLOWED_PORTS = new Set(["", "80", "443"]);

export class PageTitleError extends Error {
  constructor(readonly reason: string) {
    super(`Page title unavailable: ${reason}`);
  }
}

/**
 * A DNS lookup that refuses private, loopback, link-local and metadata
 * addresses. Used as the connection's own lookup, so a name that resolves
 * differently on the second ask (DNS rebinding) is checked again.
 */
export const publicOnlyLookup: LookupFunction = (
  hostname,
  options,
  callback,
) => {
  dnsLookup(
    hostname,
    { ...options, all: true, verbatim: true },
    (error, found) => {
      if (error) {
        callback(error, "", 4);
        return;
      }
      const addresses = found as unknown as LookupAddress[];
      if (
        addresses.length === 0 ||
        addresses.some((entry) => isDisallowedAddress(entry.address))
      ) {
        callback(new PageTitleError("destination"), "", 4);
        return;
      }
      if (options.all) {
        (callback as unknown as (e: null, a: LookupAddress[]) => void)(
          null,
          addresses,
        );
        return;
      }
      const [first] = addresses as [LookupAddress];
      callback(null, first.address, first.family);
    },
  );
};

/** Throws unless the URL may be fetched: http(s), standard port, no login. */
export function assertFetchableUrl(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new PageTitleError("protocol");
  }
  if (url.username || url.password) throw new PageTitleError("credentials");
  if (!ALLOWED_PORTS.has(url.port)) throw new PageTitleError("port");
  // An IP literal never reaches the lookup, so it is checked here.
  if (isDisallowedAddress(url.hostname)) {
    throw new PageTitleError("destination");
  }
}

function requestOnce(url: URL, signal: AbortSignal): Promise<IncomingMessage> {
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = client.get(
      url,
      {
        lookup: publicOnlyLookup,
        signal,
        headers: {
          accept: "text/html",
          "accept-encoding": "identity",
          "user-agent": "MargayaLinkPreview/1.0",
        },
      },
      resolve,
    );
    request.on("error", reject);
  });
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const value =
        code[1] === "x" || code[1] === "X"
          ? Number.parseInt(code.slice(2), 16)
          : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(value) && value > 0 && value <= 0x10ffff
        ? String.fromCodePoint(value)
        : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

/** The page title in an HTML head, decoded and on one line, or null. */
export function extractPageTitle(html: string): string | null {
  const match =
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) ??
    html.match(
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i,
    );
  if (!match?.[1]) return null;
  const title = decodeEntities(match[1]).replace(/\s+/g, " ").trim();
  return title || null;
}

async function readHtmlHead(response: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response) {
    const buffer = chunk as Buffer;
    size += buffer.byteLength;
    chunks.push(buffer);
    if (size >= pageTitleLimits.maxBytes) break;
    // The title sits in the head; stop once it closed.
    if (/<\/title>|<\/head>/i.test(buffer.toString("latin1"))) break;
  }
  response.destroy();
  return Buffer.concat(chunks)
    .subarray(0, pageTitleLimits.maxBytes)
    .toString("utf8");
}

/**
 * The <title> of a public HTML page, or null when it has none. Throws
 * `PageTitleError` for anything refused or failed; never includes the URL
 * or response content in the error.
 */
export async function fetchPageTitle(rawUrl: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), pageTitleLimits.timeoutMs);
  try {
    let url = new URL(rawUrl);
    for (let hop = 0; hop <= pageTitleLimits.maxRedirects; hop++) {
      assertFetchableUrl(url);
      const response = await withoutOutboundTelemetry(() =>
        requestOnce(url, controller.signal),
      );
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.destroy();
        url = new URL(response.headers.location, url);
        continue;
      }
      if (status < 200 || status >= 300) {
        response.destroy();
        throw new PageTitleError("http");
      }
      const type = String(response.headers["content-type"] ?? "");
      if (!/^\s*text\/html\b/i.test(type)) {
        response.destroy();
        throw new PageTitleError("content-type");
      }
      return extractPageTitle(await readHtmlHead(response));
    }
    throw new PageTitleError("redirects");
  } catch (error) {
    if (error instanceof PageTitleError) throw error;
    throw new PageTitleError(controller.signal.aborted ? "timeout" : "network");
  } finally {
    clearTimeout(timer);
  }
}
