import { client } from "@margaya/libs";

import { HttpError } from "@/lib/http-error";

type BulkOperationType =
  | "updateStatus"
  | "updatePriority"
  | "updateAssignee"
  | "addAssignee"
  | "removeAssignee"
  | "delete"
  | "addLabel"
  | "removeLabel"
  | "updateDueDate"
  | "updateStartDate"
  | "archive"
  | "unarchive";

async function bulkOperation({
  taskIds,
  operation,
  value,
}: {
  taskIds: string[];
  operation: BulkOperationType;
  value?: string | null;
}) {
  const response = await client.task.bulk.$patch({
    json: { taskIds, operation, value },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default bulkOperation;
