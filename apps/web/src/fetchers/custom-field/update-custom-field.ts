import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

type Endpoint = (typeof client)["custom-field"][":id"]["$patch"];

export type UpdateCustomFieldRequest = InferRequestType<Endpoint>["json"] & {
  id: string;
};

async function updateCustomField({ id, ...json }: UpdateCustomFieldRequest) {
  const response = await client["custom-field"][":id"].$patch({
    param: { id },
    json,
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default updateCustomField;
