import type { QueryClient } from "@tanstack/react-query";

// User-channel hints for personal Home data. They carry no content, only the
// workspace and the tab that made the change: that tab already updated its
// caches optimistically, so it skips its own echo.

const HOME_MESSAGE_KEYS: Record<string, string> = {
  STICKIES_UPDATED: "stickies",
  QUICK_LINKS_UPDATED: "quick-links",
  HOME_PREFERENCES_UPDATED: "home-preferences",
};

type HomeMessage = {
  type?: string;
  workspaceId?: string | null;
  originWindowId?: string | null;
};

/** Invalidates the matching queries; returns whether it handled the type. */
export function handleHomeUserMessage(
  queryClient: Pick<QueryClient, "invalidateQueries">,
  message: HomeMessage,
  currentWindowId: string,
): boolean {
  const root = message.type ? HOME_MESSAGE_KEYS[message.type] : undefined;
  if (!root) return false;
  if (message.originWindowId && message.originWindowId === currentWindowId) {
    return true;
  }
  void queryClient.invalidateQueries({
    queryKey: message.workspaceId ? [root, message.workspaceId] : [root],
  });
  return true;
}
