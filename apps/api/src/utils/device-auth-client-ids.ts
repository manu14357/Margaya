// Clients that may start a device authorization (Better Auth's device flow).
// Margaya Desktop uses it when deep links can't reach the app.
export const DEFAULT_DEVICE_AUTH_CLIENT_IDS = [
  "margaya-cli",
  "margaya-mcp",
  "margaya-desktop",
] as const;

/** DEVICE_AUTH_CLIENT_IDS (comma list) when set, else the defaults. */
export function getDeviceAuthClientIds(
  raw = process.env.DEVICE_AUTH_CLIENT_IDS,
): Set<string> {
  const configured = raw?.trim();
  if (configured) {
    return new Set(
      configured
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }
  return new Set(DEFAULT_DEVICE_AUTH_CLIENT_IDS);
}
