import { generateLink } from "./generate-link";

/** The key people type and paste: the project slug in upper case, "-", the number (WEB-12). */
export function formatTaskKey(
  slug: string,
  number: number | null | undefined,
): string {
  return `${slug.toUpperCase()}-${number ?? 0}`;
}

/**
 * A shareable link to the task's full page. It uses the task's own project,
 * which may differ from the page it is copied from, and respects VITE_APP_URL.
 */
export function taskUrl({
  workspaceId,
  projectId,
  taskId,
}: {
  workspaceId: string;
  projectId: string;
  taskId: string;
}): string {
  return generateLink(
    `/dashboard/workspace/${workspaceId}/project/${projectId}/task/${taskId}`,
  );
}

/** The in-app path of a readable task link: /dashboard/workspace/{id}/task/WEB-12. */
export function taskKeyPath(workspaceId: string, key: string): string {
  return `/dashboard/workspace/${workspaceId}/task/${encodeURIComponent(key)}`;
}

/**
 * The link "Copy link" shares: readable (…/task/WEB-12) once the project key
 * and number are known, else the id link. Both keep working.
 */
export function shareableTaskUrl({
  workspaceId,
  projectId,
  taskId,
  slug,
  number,
}: {
  workspaceId: string;
  projectId: string;
  taskId: string;
  slug: string | null | undefined;
  number: number | null | undefined;
}): string {
  if (slug && number != null && number > 0) {
    return generateLink(taskKeyPath(workspaceId, formatTaskKey(slug, number)));
  }
  return taskUrl({ workspaceId, projectId, taskId });
}
