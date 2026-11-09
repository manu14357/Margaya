/**
 * Where a link in written Markdown (an agent's answer, a notification's
 * body) may go: a path in this app, opened in place, or an http(s) page
 * elsewhere, opened in a new tab. Everything else is no link at all:
 * other schemes (javascript:, data:, mailto:), credentials, and relative
 * forms a browser would read as another host ("//host", "/\host").
 */
export type SafeLink =
  | { kind: "app"; href: string }
  | { kind: "web"; href: string };

const ABSOLUTE_WEB_URL = /^https?:\/\//i;

export function resolveSafeLink(
  href: string | null | undefined,
  origin: string = window.location.origin,
): SafeLink | null {
  const raw = href?.trim() ?? "";
  const path = raw.startsWith("/") && !/^\/[/\\]/.test(raw);
  if (!path && !ABSOLUTE_WEB_URL.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.origin === new URL(origin).origin) {
    return { kind: "app", href: `${url.pathname}${url.search}${url.hash}` };
  }
  return { kind: "web", href: url.href };
}
