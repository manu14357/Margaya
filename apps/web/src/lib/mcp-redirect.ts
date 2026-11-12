/**
 * Whether an OAuth redirect goes back to an app on this computer. Any local
 * app could listen there, so the consent page warns about it.
 */
export function isLoopbackRedirect(uri: string | undefined): boolean {
  if (!uri) return false;
  try {
    const { hostname } = new URL(uri);
    return ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
  } catch {
    return false;
  }
}
