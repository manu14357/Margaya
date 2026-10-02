import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type RecordRecentVisitRequest = InferRequestType<
  (typeof client)["recent-visit"]["$post"]
>["json"];

async function recordRecentVisit(request: RecordRecentVisitRequest) {
  const response = await client["recent-visit"].$post({ json: request });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default recordRecentVisit;
