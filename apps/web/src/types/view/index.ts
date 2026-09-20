import type { client } from "@margaya/libs";
import type { InferRequestType, InferResponseType } from "hono/client";

// Saved views (/api/view), inferred from the typed client.

type ViewApi = (typeof client)["view"];

export type SavedView = InferResponseType<ViewApi[":id"]["$get"], 200>;

export type CreateViewRequest = InferRequestType<ViewApi["$post"]>["json"];

export type UpdateViewRequest = InferRequestType<
  ViewApi[":id"]["$patch"]
>["json"];

export type ViewAccess = SavedView["access"];
