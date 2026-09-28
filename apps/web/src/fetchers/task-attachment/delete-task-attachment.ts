import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function deleteTaskAttachment({
  taskId,
  attachmentId,
}: {
  taskId: string;
  attachmentId: string;
}) {
  const response = await client["task-attachment"][":taskId"][
    ":attachmentId"
  ].$delete({ param: { taskId, attachmentId } });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default deleteTaskAttachment;
