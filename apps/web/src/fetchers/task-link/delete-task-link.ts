import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function deleteTaskLink({
  taskId,
  linkId,
}: {
  taskId: string;
  linkId: string;
}) {
  const response = await client["task-link"][":taskId"][":linkId"].$delete({
    param: { taskId, linkId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default deleteTaskLink;
