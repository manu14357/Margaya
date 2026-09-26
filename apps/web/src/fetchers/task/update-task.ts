import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";
import type Task from "@/types/task";

type UpdateTaskPriority = InferRequestType<
  (typeof client)["task"][":id"]["$put"]
>["json"]["priority"];

export type UpdateTaskInput = Task & {
  /**
   * Replaces the assignees. Only a caller that edits them sets it; every
   * other caller echoes `userId`, the first assignee, which keeps them all.
   */
  replaceAssigneeIds?: string[];
};

async function updateTask(taskId: string, task: UpdateTaskInput) {
  const response = await client.task[":id"].$put({
    param: { id: taskId },
    json: {
      userId: task.userId || "",
      ...(task.replaceAssigneeIds
        ? { assigneeIds: task.replaceAssigneeIds }
        : {}),
      title: task.title,
      description: task.descriptionDeferred
        ? undefined
        : task.description || "",
      status: task.status,
      // The API validates priority against a picklist that has no empty
      // member, so a task carrying no priority has to be sent as the explicit
      // "no priority" value rather than "". Sending "" rejected the whole
      // update, which is what broke dragging every imported task.
      priority: (task.priority || "no-priority") as UpdateTaskPriority,
      startDate: task.startDate?.toString(),
      dueDate: task.dueDate?.toString(),
      position: task.position ?? 0,
      projectId: task.projectId,
    },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  const data = await response.json();

  return data;
}

export default updateTask;
