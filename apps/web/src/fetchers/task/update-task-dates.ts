import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/**
 * Sets a task's start and due dates in one write, and nothing else. A date
 * left out keeps its stored value; null clears it.
 */
async function updateTaskDates(
  taskId: string,
  dates: { startDate?: string | null; dueDate?: string | null },
) {
  const response = await client.task.dates[":id"].$put({
    param: { id: taskId },
    json: dates,
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default updateTaskDates;
