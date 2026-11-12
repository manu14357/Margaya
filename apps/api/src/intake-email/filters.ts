// Pure abuse checks for email intake (#8): loop and bounce detection, spam
// headers, sender domain lists and the plus-address token of a recipient.

export type MailHeaders = Map<string, string[]>;

export type IgnoreReason =
  | "auto_reply"
  | "bounce"
  | "bulk"
  | "loop"
  | "spam"
  | "sender_blocked"
  | "sender_not_allowed"
  | "no_sender"
  | "too_large"
  | "rate_limited"
  | "duplicate"
  | "no_project";

export const SPAM_SCORE_THRESHOLD = 5;

function first(headers: MailHeaders, name: string): string {
  return headers.get(name)?.[0]?.trim() ?? "";
}

/**
 * Why a message must not become a request because answering it could loop
 * (auto-replies, bounces, bulk mail, our own mail), or null.
 */
export function loopReason(
  headers: MailHeaders,
  from: string | null,
  contentType: string,
  ownAddresses: readonly string[],
): IgnoreReason | null {
  const autoSubmitted = first(headers, "auto-submitted").toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return "auto_reply";
  if (headers.has("x-autoreply") || headers.has("x-autorespond")) {
    return "auto_reply";
  }
  const precedence = first(headers, "precedence").toLowerCase();
  if (["bulk", "junk", "list", "auto_reply"].includes(precedence)) {
    return precedence === "auto_reply" ? "auto_reply" : "bulk";
  }
  if (contentType === "multipart/report") return "bounce";
  if (first(headers, "return-path") === "<>") return "bounce";
  const local = from?.split("@")[0] ?? "";
  if (/^(mailer-daemon|postmaster)$/i.test(local)) return "bounce";
  if (from && ownAddresses.includes(from)) return "loop";
  return null;
}

/** Spam verdicts the receiving server or provider already added. */
export function isSpam(headers: MailHeaders, spamScore?: number | null) {
  if (/^yes\b/i.test(first(headers, "x-spam-flag"))) return true;
  if (/^yes\b/i.test(first(headers, "x-spam-status"))) return true;
  const headerScore = Number.parseFloat(first(headers, "x-spam-score"));
  const score =
    typeof spamScore === "number" && Number.isFinite(spamScore)
      ? spamScore
      : headerScore;
  return Number.isFinite(score) && score >= SPAM_SCORE_THRESHOLD;
}

const DOMAIN =
  /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
export const MAX_DOMAIN_ENTRIES = 200;

/** A cleaned domain list: lower case, `@` and `*.` dropped, valid, unique. */
export function normalizeDomainList(values: readonly string[]): {
  domains: string[];
  invalid: string[];
} {
  const domains = new Set<string>();
  const invalid: string[] = [];
  for (const value of values) {
    const domain = value
      .trim()
      .toLowerCase()
      .replace(/^\*?\.|^@/, "")
      .replace(/\.$/, "");
    if (!domain) continue;
    if (DOMAIN.test(domain)) domains.add(domain);
    else invalid.push(value.trim());
  }
  return { domains: [...domains].slice(0, MAX_DOMAIN_ENTRIES), invalid };
}

function domainMatches(domain: string, entry: string) {
  return domain === entry || domain.endsWith(`.${entry}`);
}

/** Blocked domains always win; a non-empty allowlist admits only its own. */
export function senderDomainReason(
  address: string,
  allowed: readonly string[],
  blocked: readonly string[],
): IgnoreReason | null {
  const domain = address.split("@")[1]?.toLowerCase() ?? "";
  if (blocked.some((entry) => domainMatches(domain, entry))) {
    return "sender_blocked";
  }
  if (
    allowed.length > 0 &&
    !allowed.some((entry) => domainMatches(domain, entry))
  ) {
    return "sender_not_allowed";
  }
  return null;
}

const TOKEN = /^[a-z0-9]{12,40}$/;

/**
 * The project tokens in the recipients: `<local>+<token>@<domain>` of the
 * instance's base address, in order and without repeats.
 */
export function recipientTokens(
  recipients: readonly string[],
  base: { local: string; domain: string },
): string[] {
  const tokens = new Set<string>();
  for (const recipient of recipients) {
    const [local = "", domain = ""] = recipient.toLowerCase().split("@");
    if (domain !== base.domain) continue;
    const plus = local.indexOf("+");
    if (plus < 0 || local.slice(0, plus) !== base.local) continue;
    const token = local.slice(plus + 1);
    if (TOKEN.test(token)) tokens.add(token);
  }
  return [...tokens];
}
