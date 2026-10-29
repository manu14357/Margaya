import { client } from "@margaya/libs";
import type { InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type InstanceStatus = InferResponseType<
  (typeof client)["instance"]["status"]["$get"],
  200
>;

export async function getInstanceStatus(): Promise<InstanceStatus> {
  const response = await client.instance.status.$get();
  if (!response.ok) {
    // Surface the server's error body when available so the UI can
    // distinguish "instance unreachable" from other failures.
    let detail = "";
    try {
      detail = (await response.text()).trim();
    } catch {}
    throw new HttpError(
      response.status,
      detail
        ? `Failed to fetch instance status: ${detail}`
        : "Failed to fetch instance status",
    );
  }
  return response.json();
}
