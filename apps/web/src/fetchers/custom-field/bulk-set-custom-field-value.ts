import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type BulkSetCustomFieldValueRequest = InferRequestType<
  (typeof client)["custom-field"]["value"]["bulk"]["$put"]
>["json"];

async function bulkSetCustomFieldValue(json: BulkSetCustomFieldValueRequest) {
  const response = await client["custom-field"].value.bulk.$put({ json });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default bulkSetCustomFieldValue;
