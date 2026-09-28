import { client } from "@margaya/libs";
import type { InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type DescriptionVersion = InferResponseType<
  (typeof client)["task"][":id"]["description-versions"]["$get"],
  200
>[number];

/** A task description's saved versions, newest first. */
async function listDescriptionVersions(
  taskId: string,
): Promise<DescriptionVersion[]> {
  const response = await client.task[":id"]["description-versions"].$get({
    param: { id: taskId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default listDescriptionVersions;
