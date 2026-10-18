import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";
import type { ApplyTaskTemplateInput } from "@/types/task-template";

/**
 * Creates a task from a template on the server, with its labels and
 * sub-tasks. `title` is merged into the title pattern; `status` overrides
 * the template's column.
 */
async function applyTaskTemplate(id: string, input: ApplyTaskTemplateInput) {
  const response = await client["task-template"][":id"].apply.$post({
    param: { id },
    json: input,
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default applyTaskTemplate;
