import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function createTaskLink({
  taskId,
  url,
  title,
}: {
  taskId: string;
  url: string;
  title: string | null;
}) {
  const response = await client["task-link"][":taskId"].$post({
    param: { taskId },
    json: { url, title },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default createTaskLink;
