import { useMemo } from "react";
import useProjectAudience from "@/hooks/queries/project/use-project-audience";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { useProjectScope } from "@/hooks/use-project-scope";
import {
  type AssigneeEntry,
  type AssigneeFields,
  assigneesOfTask,
  embeddedAssignees,
  peopleFromMembers,
  resolveAssignees,
} from "@/lib/task-assignees";

/**
 * The people pickers offer: inside a project (ProjectScope) those who can
 * see it, which a guest may list too; elsewhere the workspace's active
 * members. Every consumer of one query result shares the same array, so
 * per-card lookups stay cheap.
 */
export function useAssigneePeople(workspaceId: string) {
  const projectId = useProjectScope();
  const workspace = useGetActiveWorkspaceUsers(projectId ? "" : workspaceId);
  const project = useProjectAudience(projectId);
  if (projectId) {
    return {
      people: project.data,
      isLoading: project.isLoading,
      audience: true,
    };
  }
  return {
    people: peopleFromMembers(workspace.data),
    isLoading: workspace.isLoading,
    audience: false,
  };
}

/** The task's assignees resolved for display, first assignee first. */
export function useTaskAssignees(
  task: AssigneeFields,
  workspaceId: string,
): AssigneeEntry[] {
  const { people, audience } = useAssigneePeople(workspaceId);
  const { assigneeIds, userId, assignees, assigneeName, assigneeImage } = task;
  return useMemo(
    () =>
      resolveAssignees(
        assigneesOfTask({ assigneeIds, userId }),
        people,
        // Without the embedded list, the mirror still names the first one.
        embeddedAssignees({ userId, assignees, assigneeName, assigneeImage }),
        { audience },
      ),
    [
      assigneeIds,
      userId,
      assignees,
      assigneeName,
      assigneeImage,
      people,
      audience,
    ],
  );
}
