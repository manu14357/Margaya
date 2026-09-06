import { resolveLegacyAssignee } from "../assignee-rules";
import { writeTaskAssignees } from "./update-task-assignees";

/**
 * The legacy single-assignee route: one user replaces everyone (keeping
 * their row when already assigned), and null or blank clears. Setting the
 * exact current single assignee changes nothing.
 */
async function updateTaskAssignee({
  id,
  userId,
  currentUserId,
}: {
  id: string;
  userId: string | null;
  currentUserId: string;
}) {
  const target = resolveLegacyAssignee(userId);
  return writeTaskAssignees({
    taskId: id,
    currentUserId,
    target: () => target,
  });
}

export default updateTaskAssignee;
