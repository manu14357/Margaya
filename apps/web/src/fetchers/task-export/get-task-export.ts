import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function getTaskExport(id: string) {
  const response = await client["task-export"][":id"].$get({
    param: { id },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getTaskExport;
