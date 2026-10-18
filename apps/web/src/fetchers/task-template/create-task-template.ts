import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";
import type { CreateTaskTemplateInput } from "@/types/task-template";

/** Adds a template at the end of the project's list. */
async function createTaskTemplate(input: CreateTaskTemplateInput) {
  const response = await client["task-template"].$post({ json: input });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default createTaskTemplate;
