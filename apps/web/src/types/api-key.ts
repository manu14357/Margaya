import type { client } from "@margaya/libs";
import type { InferResponseType } from "hono/client";

type Routes = (typeof client)["api-key"];

/** One of the caller's keys with its scope (never the key itself). */
export type ApiKey = InferResponseType<Routes["$get"], 200>[number];

export type ApiKeyScope = ApiKey["scope"];
export type ApiKeyAccess = ApiKeyScope["access"];

export type CreateApiKeyResponse = InferResponseType<Routes["$post"], 200>;

export type ApiKeyRequestPage = InferResponseType<
  Routes[":id"]["requests"]["$get"],
  200
>;
export type ApiKeyRequest = ApiKeyRequestPage["items"][number];
