// Inline validation for task links. Mirrors the API's link-url rules exactly
// (the API stays the authority): https is assumed without a scheme, only http
// and https pass, credentials and single-label hosts are refused, and the
// parser's serialized form is what gets saved.

export const MAX_LINK_URL_LENGTH = 2048;
export const MAX_LINK_TITLE_LENGTH = 255;

export type LinkErrorCode =
  | "required"
  | "invalid"
  | "credentials"
  | "tooLong"
  | "titleTooLong";

/** The i18n key of each validation message. */
export const LINK_ERROR_KEYS: Record<LinkErrorCode, string> = {
  required: "tasks:links.errors.required",
  invalid: "tasks:links.errors.invalid",
  credentials: "tasks:links.errors.credentials",
  tooLong: "tasks:links.errors.tooLong",
  titleTooLong: "tasks:links.errors.titleTooLong",
};

export type LinkUrlResult =
  | { ok: true; url: string; host: string }
  | { ok: false; error: LinkErrorCode };

export type LinkTitleResult =
  | { ok: true; title: string | null }
  | { ok: false; error: LinkErrorCode };

// A leading "name:" is a scheme unless digits follow the colon, which makes
// it a host and port ("localhost:3000").
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:(?!\d)/i;
const IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/;

function hasWhitespaceOrControl(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x20 || (code >= 0x7f && code <= 0x9f) || /\s/u.test(char)) {
      return true;
    }
  }
  return false;
}

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

/** github.com and its subdomains get the GitHub mark instead of a link. */
export function isGithubHost(host: string): boolean {
  const name = host.toLowerCase();
  return name === "github.com" || name.endsWith(".github.com");
}

export function normalizeLinkUrl(raw: string): LinkUrlResult {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "required" };
  if (hasWhitespaceOrControl(trimmed)) return { ok: false, error: "invalid" };

  const withScheme = SCHEME_PATTERN.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, error: "invalid" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "invalid" };
  }
  if (url.username || url.password) return { ok: false, error: "credentials" };
  if (!isAcceptedHost(url.hostname)) return { ok: false, error: "invalid" };

  const serialized = url.toString();
  if (serialized.length > MAX_LINK_URL_LENGTH) {
    return { ok: false, error: "tooLong" };
  }
  return { ok: true, url: serialized, host: displayHost(serialized) };
}

/** Titles are trimmed; empty becomes null. */
export function normalizeLinkTitle(
  raw: string | null | undefined,
): LinkTitleResult {
  const trimmed = raw?.trim() ?? "";
  if (trimmed === "") return { ok: true, title: null };
  if (trimmed.length > MAX_LINK_TITLE_LENGTH) {
    return { ok: false, error: "titleTooLong" };
  }
  return { ok: true, title: trimmed };
}
