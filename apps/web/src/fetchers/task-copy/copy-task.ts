import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

type CopyTaskBody = InferRequestType<
  (typeof client)["task-copy"][":taskId"]["$post"]
>["json"];

export type CopyOption = NonNullable<CopyTaskBody["include"]>[number];

/** Makes a copy of a task; `skipped` lists the options that didn't apply. */
async function copyTask({
  taskId,
  body,
}: {
  taskId: string;
  body: CopyTaskBody;
}) {
  const response = await client["task-copy"][":taskId"].$post({
    param: { taskId },
    json: body,
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default copyTask;
