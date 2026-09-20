import { isSigningOut } from "./sign-out";

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export function isUnauthorizedError(error: unknown): boolean {
  return error instanceof HttpError && error.status === 401;
}

// Shared unauthorized redirect for both the React Query error cache and direct
// fetcher calls (e.g. route loaders) that bypass the QueryCache. Stashes the
// current pathname/search/hash so the sign-in page can return the user to
// where they were instead of dropping them on /dashboard. It stays quiet
// during a sign-out and on the auth pages themselves, where a 401 is expected
// and a reload would only blank the screen.
export function handleUnauthorized(): void {
  if (isSigningOut()) return;
  const { pathname, search, hash } = window.location;
  if (pathname.startsWith("/auth/")) return;
  const currentPath = pathname + search + hash;
  const target = currentPath
    ? `/auth/sign-in?redirect=${encodeURIComponent(currentPath)}`
    : "/auth/sign-in";
  window.location.replace(target);
}
