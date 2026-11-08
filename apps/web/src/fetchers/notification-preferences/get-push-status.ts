import { client } from "@margaya/libs";
import type { InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type PushStatus = InferResponseType<
  (typeof client)["notification-preferences"]["push"]["$get"],
  200
>;

export type PushDevice = PushStatus["subscriptions"][number];

async function getPushStatus(): Promise<PushStatus> {
  const response = await client["notification-preferences"].push.$get();

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getPushStatus;
