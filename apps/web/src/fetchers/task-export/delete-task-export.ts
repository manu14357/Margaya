import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** Deletes an export and its file; a running export answers 409. */
async function deleteTaskExport(id: string) {
  const response = await client["task-export"][":id"].$delete({
    param: { id },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default deleteTaskExport;
