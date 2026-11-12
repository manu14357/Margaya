import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type CreateTaskRequest = InferRequestType<
  (typeof client)["task"][":projectId"]["$post"]
>["json"] &
  InferRequestType<(typeof client)["task"][":projectId"]["$post"]>["param"];

async function createTask(
  title: string,
  description: string,
  projectId: string,
  assigneeIds: string[] | undefined,
  status: string,
  startDate: Date | undefined,
  dueDate: Date | undefined,
  priority: CreateTaskRequest["priority"],
  customFields?: { fieldId: string; value: string }[],
  parentId?: string,
  isMilestone?: boolean,
  aiAssist?: CreateTaskRequest["aiAssist"],
) {
  if (!projectId) {
    throw new Error("No project selected for task creation");
  }

  const response = await client.task[":projectId"].$post({
    json: {
      title,
      description,
      // Always explicit: the web prefills the project's default assignee
      // itself, so an empty list must stay unassigned on the server.
      assigneeIds: assigneeIds ?? [],
      status,
      startDate: startDate?.toISOString() || undefined,
      dueDate: dueDate?.toISOString() || undefined,
      priority,
      customFields,
      parentId: parentId || undefined,
      ...(isMilestone ? { isMilestone } : {}),
      ...(aiAssist ? { aiAssist } : {}),
    },
    param: { projectId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  const data = await response.json();

  return data;
}

export default createTask;
