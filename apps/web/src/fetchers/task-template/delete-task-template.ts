import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** Deletes a template; tasks created from it stay as they are. */
async function deleteTaskTemplate(id: string) {
  const response = await client["task-template"][":id"].$delete({
    param: { id },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default deleteTaskTemplate;
