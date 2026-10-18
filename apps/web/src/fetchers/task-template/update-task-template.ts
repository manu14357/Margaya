import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";
import type { UpdateTaskTemplateInput } from "@/types/task-template";

/** Changes any subset of a template's fields. */
async function updateTaskTemplate(id: string, patch: UpdateTaskTemplateInput) {
  const response = await client["task-template"][":id"].$patch({
    param: { id },
    json: patch,
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default updateTaskTemplate;
