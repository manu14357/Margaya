// What the identity provider forms check before asking the server, which has the
// last word (apps/api/src/identity/schema.ts).

const DOMAIN = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

/** "Acme.example, b.example" as the list the API takes. */
export function parseDomains(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\s,]+/)
        .map((domain) => domain.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

export function areValidDomains(domains: string[]): boolean {
  return domains.length > 0 && domains.every((domain) => DOMAIN.test(domain));
}

/** https, or http only on this machine, as the API requires. */
export function isSafeSignOnUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    if (url.protocol === "https:") return true;
    return (
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    );
  } catch {
    return false;
  }
}

const EXPIRY_WARNING_DAYS = 30;

/** An expired signing certificate stops sign-in, so it needs warning ahead. */
export function certificateStatus(
  expiresAt: string | Date,
  now: Date = new Date(),
): "valid" | "expiring" | "expired" {
  const remaining = new Date(expiresAt).getTime() - now.getTime();
  if (remaining <= 0) return "expired";
  return remaining <= EXPIRY_WARNING_DAYS * 86_400_000 ? "expiring" : "valid";
}
