// Sign-out coordination. While a sign-out runs, realtime sockets close, the
// 401 handler stays quiet (requests that race the session's end are expected
// to fail) and the auth routes do not bounce the still-valid session back to
// the dashboard.

let signingOut = false;
const listeners = new Set<() => void>();

export function isSigningOut(): boolean {
  return signingOut;
}

export function beginSignOut(): void {
  signingOut = true;
  for (const listener of [...listeners]) listener();
}

export function endSignOut(): void {
  signingOut = false;
}

/** Runs `listener` when a sign-out begins. Returns the unsubscribe. */
export function onSignOut(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
