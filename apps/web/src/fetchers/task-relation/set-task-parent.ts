import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** Sets, changes or (with null) clears a task's parent in one step. */
async function setTaskParent({
  taskId,
  parentTaskId,
}: {
  taskId: string;
  parentTaskId: string | null;
}) {
  const response = await client["task-relation"].parent[":taskId"].$put({
    param: { taskId },
    json: { parentTaskId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default setTaskParent;
