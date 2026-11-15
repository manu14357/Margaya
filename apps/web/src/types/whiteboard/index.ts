import type { client } from "@margaya/libs";
import type { InferResponseType } from "hono/client";

type Api = (typeof client)["whiteboard"];

export type WhiteboardSummary = InferResponseType<
  Api["$get"],
  200
>["whiteboards"][number];

export type Whiteboard = InferResponseType<Api[":id"]["$get"], 200>;

/** A board in the workspace-wide list: a summary plus its project. */
export type WorkspaceWhiteboard = InferResponseType<
  Api["workspace"][":workspaceId"]["$get"],
  200
>["whiteboards"][number];

export type WhiteboardCapabilities = Whiteboard["capabilities"];

export type WhiteboardContent = InferResponseType<
  Api[":id"]["content"]["$get"],
  200
>;

export type WhiteboardPublication = InferResponseType<
  Api[":id"]["publication"]["$post"],
  200
>;

export type TaskWhiteboard = InferResponseType<
  Api["by-task"][":taskId"]["$get"],
  200
>["whiteboards"][number];

export type PublicWhiteboard = InferResponseType<
  (typeof client)["public-whiteboard"][":token"]["$get"],
  200
>;

export type WhiteboardActivityPage = InferResponseType<
  Api[":id"]["activity"]["$get"],
  200
>;

export type WhiteboardActivityEntry = WhiteboardActivityPage["items"][number];

/** The list's sort (stored per browser). */
export type WhiteboardSortField = "updatedAt" | "createdAt" | "title";
export type WhiteboardSort = {
  field: WhiteboardSortField;
  direction: "asc" | "desc";
};

/** The list's server-side filters, part of its query key. */
export type WhiteboardListFilters = { archived: boolean; q: string };
