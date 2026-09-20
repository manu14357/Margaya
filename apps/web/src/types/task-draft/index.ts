import type { client } from "@margaya/libs";
import type { InferRequestType, InferResponseType } from "hono/client";

type DraftRoutes = (typeof client)["task-draft"];

/** One of the caller's drafts, with its description. */
export type TaskDraft = InferResponseType<DraftRoutes[":id"]["$get"], 200>;

export type TaskDraftList = InferResponseType<DraftRoutes["$get"], 200>;

/** A draft in lists: every field but the description. */
export type TaskDraftSummary = TaskDraftList["drafts"][number];

export type PublishedTaskDraft = InferResponseType<
  DraftRoutes[":id"]["publish"]["$post"],
  200
>;

/** The fields a create, update or publish request can carry. */
export type TaskDraftPatch = InferRequestType<
  DraftRoutes[":id"]["$patch"]
>["json"];

export type DroppedDraftField = PublishedTaskDraft["dropped"][number];

export type TaskDraftLabel = TaskDraft["labels"][number];

/** The Drafts page's project filter: a project id, or "none". */
export type TaskDraftFilters = { projectId?: string; q?: string };
