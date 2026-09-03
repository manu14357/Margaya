const WINDOW_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The browser tab that caused a user-channel event, taken from the event's
 * initiatorId ("<userId>:<windowId>"). Null for API keys, MCP, calls without
 * a window header, or anything malformed. It is the user's own random tab id,
 * sent only to that user's sockets, so the tab can skip its own echo.
 */
export function originWindowId(
  userId: string,
  initiatorId: string | undefined,
): string | null {
  const prefix = `${userId}:`;
  if (!initiatorId?.startsWith(prefix)) return null;
  const windowId = initiatorId.slice(prefix.length);
  return WINDOW_ID_PATTERN.test(windowId) ? windowId : null;
}
