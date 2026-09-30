import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";
import type { CreateViewRequest } from "@/types/view";

async function createView(json: CreateViewRequest) {
  const response = await client.view.$post({ json });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default createView;
