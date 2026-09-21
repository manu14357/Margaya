import type { EntityLink } from "@/lib/entity-links";
import { DEFAULT_PAGE_ICON, pageLogoIcon } from "./page-logo";

export function pagesListPath(workspaceId: string, projectId: string): string {
  return `/dashboard/workspace/${workspaceId}/project/${projectId}/pages`;
}

export function pagePath(
  workspaceId: string,
  projectId: string,
  pageId: string,
): string {
  return `${pagesListPath(workspaceId, projectId)}/${pageId}`;
}

/** The ids in a Margaya page URL (`…/project/{projectId}/pages/{pageId}`). */
export function parsePageUrl(
  value: string,
): { workspaceId: string; projectId: string; pageId: string } | null {
  try {
    const url = new URL(value, "http://margaya.invalid");
    const match = url.pathname.match(
      /\/dashboard\/workspace\/([^/]+)\/project\/([^/]+)\/pages\/([^/]+)\/?$/,
    );
    if (!match) return null;
    return { workspaceId: match[1], projectId: match[2], pageId: match[3] };
  } catch {
    return null;
  }
}

/**
 * Favorites and recents open a page in its editor. Their entity carries the
 * logo value only, so an icon name shows as that icon and anything else (an
 * emoji) as the page icon.
 */
export const pageEntityLink: EntityLink = {
  icon: (entity) =>
    entity.icon ? pageLogoIcon("icon", entity.icon) : DEFAULT_PAGE_ICON,
  path: (entity, workspaceId) =>
    entity.projectId
      ? pagePath(workspaceId, entity.projectId, entity.id)
      : null,
};
