import { useMemo } from "react";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import {
  type AssigneeEntry,
  type AssigneeFields,
  assigneesOfTask,
  embeddedAssignees,
  peopleFromMembers,
  resolveAssignees,
} from "@/lib/task-assignees";

/**
 * The workspace's active members as people. Every consumer of one query
 * result shares the same array, so per-card lookups stay cheap.
 */
export function useAssigneePeople(workspaceId: string) {
  const { data, isLoading } = useGetActiveWorkspaceUsers(workspaceId);
  return { people: peopleFromMembers(data), isLoading };
}

/** The task's assignees resolved for display, first assignee first. */
export function useTaskAssignees(
  task: AssigneeFields,
  workspaceId: string,
): AssigneeEntry[] {
  const { people } = useAssigneePeople(workspaceId);
  const { assigneeIds, userId, assignees, assigneeName, assigneeImage } = task;
  return useMemo(
    () =>
      resolveAssignees(
        assigneesOfTask({ assigneeIds, userId }),
        people,
        // Without the embedded list, the mirror still names the first one.
        embeddedAssignees({ userId, assignees, assigneeName, assigneeImage }),
      ),
    [assigneeIds, userId, assignees, assigneeName, assigneeImage, people],
  );
}
