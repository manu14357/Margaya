import { client } from "@margaya/libs";
import type { InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

// The workspace's monthly AI budget use, with the 80% warning.

export type AiBudgetStatus = InferResponseType<
  (typeof client)["ai"]["budget-status"]["$get"],
  200
>;

export async function getAiBudgetStatus(
  workspaceId: string,
): Promise<AiBudgetStatus> {
  const response = await client.ai["budget-status"].$get({
    query: { workspaceId },
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return (await response.json()) as AiBudgetStatus;
}
