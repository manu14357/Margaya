import { client } from "@margaya/libs";
import type { InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type TelegramIntegration = InferResponseType<
  (typeof client)["telegram-integration"]["project"][":projectId"]["$get"],
  200
>;

async function getTelegramIntegration(projectId: string) {
  const response = await client["telegram-integration"].project[
    ":projectId"
  ].$get({
    param: { projectId },
  });

  // A 404 means no integration; it is not a declared status, hence the cast.
  if ((response.status as number) === 404) {
    return null;
  }

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getTelegramIntegration;
