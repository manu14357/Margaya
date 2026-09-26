import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

export type TaskAssigneesPatch = {
  add?: string[];
  remove?: string[];
};

/** Adds and/or removes assignees, keeping everyone else. */
async function updateTaskAssignees(
  taskId: string,
  { add, remove }: TaskAssigneesPatch,
) {
  const response = await client.task.assignees[":id"].$patch({
    param: { id: taskId },
    json: {
      ...(add?.length ? { add } : {}),
      ...(remove?.length ? { remove } : {}),
    },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default updateTaskAssignees;
