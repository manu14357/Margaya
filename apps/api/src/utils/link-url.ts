// The one rule for user-entered web links (task links today). Pure functions
// with no I/O; web/lib/link-url.ts mirrors them for inline validation.

export const MAX_LINK_URL_LENGTH = 2048;
export const MAX_LINK_TITLE_LENGTH = 255;

export type LinkErrorCode =
  | "required"
  | "invalid"
  | "credentials"
  | "tooLong"
  | "titleTooLong";

export const LINK_ERROR_MESSAGES: Record<LinkErrorCode, string> = {
  required: "URL is required",
  invalid: "Enter a valid http or https URL",
  credentials: "Links can't contain a user name or password",
  tooLong: "Links can be at most 2,048 characters",
  titleTooLong: "Titles can be at most 255 characters",
};

export type LinkUrlResult =
  | { ok: true; url: string; host: string }
  | { ok: false; code: LinkErrorCode; message: string };

export type LinkTitleResult =
  | { ok: true; title: string | null }
  | { ok: false; code: LinkErrorCode; message: string };

// A leading "name:" is a scheme unless digits follow the colon, which makes
// it a host and port ("localhost:3000").
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:(?!\d)/i;
const IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/;

function fail(code: LinkErrorCode): {
  ok: false;
  code: LinkErrorCode;
  message: string;
} {
  return { ok: false, code, message: LINK_ERROR_MESSAGES[code] };
}

function hasWhitespaceOrControl(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x20 || (code >= 0x7f && code <= 0x9f) || /\s/u.test(char)) {
      return true;
    }
  }
  return false;
}

/**
 * Hosts must look like real destinations: a name with a dot, localhost, or
 * an IP literal (self-hosted teams link intranet tools by address).
 */
function isAcceptedHost(hostname: string): boolean {
  if (!hostname) return false;
  if (hostname === "localhost") return true;
  if (hostname.startsWith("[") && hostname.endsWith("]")) return true;
  if (IPV4_PATTERN.test(hostname)) return true;
  return hostname.includes(".");
}

/** The hostname without a single leading "www.", for display. */
export function displayHost(url: string): string {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return "";
  }
  return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
}

/**
 * Normalizes a user-entered link: https is assumed without a scheme, only
 * http and https are accepted, credentials and single-label hosts are
 * refused, and the parser's serialized form is returned (lowercase host,
 * default port dropped, trailing slash for a bare host, fragment kept).
 */
export function normalizeLinkUrl(raw: string): LinkUrlResult {
  const trimmed = raw.trim();
  if (!trimmed) return fail("required");
  if (hasWhitespaceOrControl(trimmed)) return fail("invalid");

  const withScheme = SCHEME_PATTERN.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return fail("invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return fail("invalid");
  }
  if (url.username || url.password) return fail("credentials");
  if (!isAcceptedHost(url.hostname)) return fail("invalid");

  const serialized = url.toString();
  if (serialized.length > MAX_LINK_URL_LENGTH) return fail("tooLong");
  return { ok: true, url: serialized, host: displayHost(serialized) };
}

/** Titles are trimmed; empty becomes null. */
export function normalizeLinkTitle(
  raw: string | null | undefined,
): LinkTitleResult {
  const trimmed = raw?.trim() ?? "";
  if (trimmed === "") return { ok: true, title: null };
  if (trimmed.length > MAX_LINK_TITLE_LENGTH) return fail("titleTooLong");
  return { ok: true, title: trimmed };
}
