import { isGuestRole } from "@margaya/permissions";

export { isGuestRole };

/**
 * The shell destinations a guest has. The API is the authority (it answers 404
 * for anything else); this only keeps the app from offering screens that
 * would be empty. Settings stays for the guest's own account.
 */
export const GUEST_DESTINATIONS = [
  "inbox",
  "my-work",
  "projects",
  "settings",
] as const;

// The workspace screens that show only what the guest's projects hold. The
// rest (Home, members, analytics, views...) are about the whole workspace.
const GUEST_SCREENS = new Set([
  "project",
  "task",
  "projects",
  "inbox",
  "my-work",
  "search",
]);

/** Whether a guest may open this `/dashboard/workspace/{id}/...` path. */
export function guestMayOpen(pathname: string): boolean {
  const screen = pathname.match(/^\/dashboard\/workspace\/[^/]+\/([^/]+)/)?.[1];
  return screen !== undefined && GUEST_SCREENS.has(screen);
}
