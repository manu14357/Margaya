import { client } from "@margaya/libs";
import type { InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type AccountSecurity = InferResponseType<
  (typeof client)["user"]["security"]["$get"],
  200
>;

export type UserSession = AccountSecurity["sessions"][number];

async function getAccountSecurity() {
  const response = await client.user.security.$get();

  if (!response.ok) {
    throw new HttpError(response.status, "Failed to load account security");
  }

  return response.json();
}

export default getAccountSecurity;
