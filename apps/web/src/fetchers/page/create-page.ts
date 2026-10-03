import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type CreatePageRequest = InferRequestType<
  (typeof client)["page"]["project"][":projectId"]["$post"]
>["json"];

async function createPage(projectId: string, json: CreatePageRequest) {
  const response = await client.page.project[":projectId"].$post({
    param: { projectId },
    json,
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default createPage;
