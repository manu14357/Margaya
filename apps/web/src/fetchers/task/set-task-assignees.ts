import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** Replaces a task's assignees with this ordered list; [] unassigns everyone. */
async function setTaskAssignees(taskId: string, assigneeIds: string[]) {
  const response = await client.task.assignees[":id"].$put({
    param: { id: taskId },
    json: { assigneeIds },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default setTaskAssignees;
