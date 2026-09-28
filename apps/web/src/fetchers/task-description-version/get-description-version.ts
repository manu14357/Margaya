import { client } from "@margaya/libs";
import type { InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type DescriptionVersionDetail = InferResponseType<
  (typeof client)["task"][":id"]["description-versions"][":versionId"]["$get"],
  200
>;

/** One saved version of a task description, with its markdown. */
async function getDescriptionVersion(
  taskId: string,
  versionId: string,
): Promise<DescriptionVersionDetail> {
  const response = await client.task[":id"]["description-versions"][
    ":versionId"
  ].$get({ param: { id: taskId, versionId } });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getDescriptionVersion;
