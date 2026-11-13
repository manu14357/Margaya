import type { QueryClient } from "@tanstack/react-query";
import { invalidateUserProfileQueries } from "@/hooks/mutations/invalidate-user-profile-queries";
import { invalidateProjectListQueries } from "@/hooks/mutations/project/invalidate-project-list-queries";
import { userTimezoneQueryKey } from "@/hooks/queries/user/use-user-timezone";
import { invalidateTaskQueries } from "@/lib/task-query/cache";

// User-socket hints about shared workspace data (ws/workspace-hints.ts in the
// API). They reach every tab and device, including the desktop app, whatever
// screen is open. They carry ids only; the handler refetches. The user
// channel does not skip the tab that made the change, so its echo refetches
// once more, which is harmless.

export type WorkspaceUserMessage = {
  type?: string;
  workspaceId?: string | null;
  userId?: string | null;
};

/** Better Auth keeps the session and organizations outside TanStack Query. */
export type AuthStoreRefresh = {
  /** Refetches the signed-in session (name, avatar, email, locale). */
  session: () => void;
  /** Refetches the workspace list and the active workspace. */
  workspaces: () => void;
};

const ws = (root: string, workspaceId?: string | null) =>
  workspaceId ? [root, workspaceId] : [root];

/** Invalidates what the hint makes stale; returns whether it handled it. */
export function handleWorkspaceUserMessage(
  queryClient: QueryClient,
  message: WorkspaceUserMessage,
  {
    currentUserId,
    refresh,
  }: { currentUserId: string; refresh: AuthStoreRefresh },
): boolean {
  switch (message.type) {
    // A person's name, avatar, email, locale or time zone changed; it shows
    // on tasks, comments, member lists and pickers. My own change also
    // reloads my session (header, locale) and time zone on my other devices.
    case "USER_PROFILE_UPDATED": {
      void invalidateUserProfileQueries(queryClient);
      if (message.userId && message.userId === currentUserId) {
        refresh.session();
        void queryClient.invalidateQueries({ queryKey: userTimezoneQueryKey });
      }
      return true;
    }
    // Name, slug, logo or settings (time zone) of a workspace.
    case "WORKSPACE_UPDATED": {
      refresh.workspaces();
      void queryClient.invalidateQueries({ queryKey: ["workspace", "full"] });
      void queryClient.invalidateQueries({
        queryKey: ws("workspace-settings", message.workspaceId),
      });
      // Cycle dates follow the workspace time zone.
      void queryClient.invalidateQueries({ queryKey: ["cycles"] });
      return true;
    }
    // A project was created, renamed, reordered, archived, trashed, restored
    // or purged: sidebars, switchers, favorites, recents, archive and trash.
    case "PROJECTS_UPDATED": {
      invalidateProjectListQueries(
        queryClient,
        message.workspaceId ?? undefined,
      );
      return true;
    }
    // Workspace labels: pickers, and the name and colour on every task.
    case "LABELS_UPDATED": {
      void queryClient.invalidateQueries({ queryKey: ["labels"] });
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      void queryClient.invalidateQueries({ queryKey: ["task"] });
      void invalidateTaskQueries(queryClient);
      return true;
    }
    // Workspace views (project views use the project socket).
    case "VIEWS_UPDATED": {
      void queryClient.invalidateQueries({
        queryKey: ws("views", message.workspaceId),
      });
      void queryClient.invalidateQueries({
        queryKey: ws("favorites", message.workspaceId),
      });
      void queryClient.invalidateQueries({
        queryKey: ws("recent-visits", message.workspaceId),
      });
      return true;
    }
    // Something in my favorites or recent visits was renamed, archived,
    // moved, trashed or deleted.
    case "REFERENCES_UPDATED": {
      void queryClient.invalidateQueries({
        queryKey: ws("favorites", message.workspaceId),
      });
      void queryClient.invalidateQueries({
        queryKey: ws("recent-visits", message.workspaceId),
      });
      return true;
    }
    default:
      return false;
  }
}
