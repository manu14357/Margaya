import type { LucideIcon } from "lucide-react";
import {
  ChartLine,
  FileText,
  FolderKanban,
  House,
  Inbox,
  Settings,
  UserRoundCheck,
} from "lucide-react";

/**
 * The shell's global destinations: one per rail item. The context panel
 * shows only the active destination's navigation.
 */
export const SHELL_DESTINATIONS = [
  "home",
  "inbox",
  "my-work",
  "projects",
  "pages",
  "analytics",
  "settings",
] as const;

export type ShellDestination = (typeof SHELL_DESTINATIONS)[number];

export type ShellDestinationMeta = {
  id: ShellDestination;
  labelKey: `navigation:shell.${string}`;
  icon: LucideIcon;
};

export const DESTINATION_META: Record<ShellDestination, ShellDestinationMeta> =
  {
    home: { id: "home", labelKey: "navigation:shell.home", icon: House },
    inbox: { id: "inbox", labelKey: "navigation:shell.inbox", icon: Inbox },
    "my-work": {
      id: "my-work",
      labelKey: "navigation:shell.myWork",
      icon: UserRoundCheck,
    },
    projects: {
      id: "projects",
      labelKey: "navigation:shell.projects",
      icon: FolderKanban,
    },
    pages: { id: "pages", labelKey: "navigation:shell.pages", icon: FileText },
    analytics: {
      id: "analytics",
      labelKey: "navigation:shell.analytics",
      icon: ChartLine,
    },
    settings: {
      id: "settings",
      labelKey: "navigation:shell.settings",
      icon: Settings,
    },
  };

/** The destination a pathname belongs to. Unknown paths belong to Home. */
export function resolveDestination(pathname: string): ShellDestination {
  if (pathname.startsWith("/dashboard/settings")) return "settings";
  if (pathname.startsWith("/dashboard/invitations")) return "home";

  const rest = pathname.match(/^\/dashboard\/workspace\/[^/]+\/?(.*)$/)?.[1];
  if (rest === undefined) return "home";

  const [first = "", , third = ""] = rest.split("/");
  switch (first) {
    case "":
    case "stickies":
      return "home";
    case "inbox":
      return "inbox";
    case "my-work":
    case "drafts":
      return "my-work";
    case "analytics":
      return "analytics";
    case "members":
      return "settings";
    case "project":
      return third === "pages" ? "pages" : "projects";
    case "projects":
    case "views":
    case "archives":
    case "search":
      return "projects";
    default:
      return "home";
  }
}

/** The landing path of a destination that has a page of its own. */
export function destinationPath(
  destination: Exclude<ShellDestination, "pages">,
  workspaceId: string,
): string {
  const base = `/dashboard/workspace/${workspaceId}`;
  switch (destination) {
    case "home":
      return base;
    case "inbox":
      return `${base}/inbox`;
    case "my-work":
      return `${base}/my-work`;
    case "projects":
      return `${base}/projects`;
    case "analytics":
      return `${base}/analytics`;
    case "settings":
      return "/dashboard/settings/account/information";
  }
}

/** The project id in a workspace pathname, if any. */
export function projectIdFromPath(pathname: string): string | undefined {
  return pathname.match(/\/project\/([^/]+)/)?.[1];
}
