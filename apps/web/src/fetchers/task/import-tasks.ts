import { client } from "@margaya/libs";

import { HttpError } from "@/lib/http-error";

export type TaskToImport = {
  title: string;
  description?: string;
  /** A column slug or name; anything else lands in the backlog. */
  status: string;
  priority?: string;
  startDate?: string | null;
  dueDate?: string | null;
  /** Workspace members to assign, in order; takes precedence over userId. */
  assigneeIds?: string[] | null;
  /** Deprecated single assignee. */
  userId?: string | null;
  archivedAt?: string | null;
  /** Label names, or { name, color }; new names are created. */
  labels?: Array<string | { name: string; color?: string }>;
  cycleId?: string;
  moduleIds?: string[];
  estimatePointId?: string;
};

async function importTasks(projectId: string, tasks: TaskToImport[]) {
  const response = await client.task.import[":projectId"].$post({
    param: { projectId },
    json: { tasks },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  const data = await response.json();
  return data;
}

export type ImportTasksResponse = Awaited<ReturnType<typeof importTasks>>;

export default importTasks;
