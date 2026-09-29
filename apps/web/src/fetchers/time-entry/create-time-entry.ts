import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type CreateTimeEntryRequest = InferRequestType<
  (typeof client)["time-entry"]["$post"]
>["json"];

async function createTimeEntry({
  taskId,
  description,
  startTime,
  endTime,
}: CreateTimeEntryRequest) {
  const response = await client["time-entry"].$post({
    json: {
      taskId,
      description,
      startTime,
      endTime,
    },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  const data = await response.json();
  return data;
}

export default createTimeEntry;
