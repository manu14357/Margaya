// Pure helpers of the intake sources page (#8).

/** Domains typed one per line or separated by commas or spaces. */
export function parseDomainInput(text: string): string[] {
  const seen = new Set<string>();
  for (const part of text.split(/[\s,;]+/)) {
    const domain = part.trim().toLowerCase();
    if (domain) seen.add(domain);
  }
  return [...seen];
}

export function formatDomains(domains: readonly string[]): string {
  return domains.join("\n");
}

/** The absolute link of a public form path, or "" without one. */
export function requestFormUrl(path: string | null, origin: string): string {
  return path ? `${origin.replace(/\/+$/, "")}${path}` : "";
}

/** Whole megabytes, for limits shown in settings. */
export function megabytes(bytes: number): number {
  return Math.max(1, Math.round(bytes / (1024 * 1024)));
}

/** Whether a typed port is empty or a valid TCP port. */
export function parsePort(value: string): number | null | "invalid" {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return "invalid";
  const port = Number(trimmed);
  return port >= 1 && port <= 65_535 ? port : "invalid";
}
