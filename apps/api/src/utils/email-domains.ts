/** The lower-case domain of an address, or "" when it has none. */
export function emailDomainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at < 0
    ? ""
    : email
        .slice(at + 1)
        .trim()
        .toLowerCase();
}

/**
 * Whether an address may hold a new account. An empty list allows any
 * domain; otherwise the domain must match exactly (no subdomains).
 */
export function emailDomainAllowed(
  email: string,
  allowed: readonly string[],
): boolean {
  if (allowed.length === 0) return true;
  const domain = emailDomainOf(email);
  return domain !== "" && allowed.includes(domain);
}
