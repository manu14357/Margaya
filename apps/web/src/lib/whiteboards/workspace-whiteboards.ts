import { isProjectFeatureEnabled } from "@/constants/project-features";
import type { WorkspaceWhiteboard } from "@/types/whiteboard";

type FeatureProject = Parameters<typeof isProjectFeatureEnabled>[0] & {
  id: string;
};

/** The projects whose Whiteboards are on, in their own order. */
export function projectsWithWhiteboards<T extends FeatureProject>(
  projects: readonly T[] | null | undefined,
): T[] {
  return (projects ?? []).filter((project) =>
    isProjectFeatureEnabled(project, "whiteboards"),
  );
}

/**
 * Whether the rail offers Whiteboards: once permissions have loaded, to
 * people with whiteboard:read in a workspace with at least one project
 * where Whiteboards are on. Guests never get it, as with Pages.
 */
export function showWhiteboardsDestination({
  isGuest,
  isCheckingPermissions,
  canRead,
  projects,
}: {
  isGuest: boolean;
  isCheckingPermissions: boolean;
  canRead: boolean;
  projects: readonly FeatureProject[] | null | undefined;
}): boolean {
  if (isGuest || isCheckingPermissions || !canRead) return false;
  return projectsWithWhiteboards(projects).length > 0;
}

export type WhiteboardProjectGroup = {
  project: WorkspaceWhiteboard["project"];
  boards: WorkspaceWhiteboard[];
};

/**
 * Boards grouped by project, keeping the boards' order inside each group;
 * groups follow the order their project first appears in.
 */
export function groupWhiteboardsByProject(
  boards: readonly WorkspaceWhiteboard[],
): WhiteboardProjectGroup[] {
  const groups = new Map<string, WhiteboardProjectGroup>();
  for (const board of boards) {
    let group = groups.get(board.project.id);
    if (!group) {
      group = { project: board.project, boards: [] };
      groups.set(board.project.id, group);
    }
    group.boards.push(board);
  }
  return [...groups.values()];
}
