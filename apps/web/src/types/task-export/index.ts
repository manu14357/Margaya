import type { client } from "@margaya/libs";
import type { InferRequestType, InferResponseType } from "hono/client";

type TaskExportRoutes = (typeof client)["task-export"];

/** One asynchronous export, with its status and file details. */
export type TaskExport = InferResponseType<
  TaskExportRoutes[":id"]["$get"],
  200
>;

export type TaskExportPage = InferResponseType<TaskExportRoutes["$get"], 200>;

export type CreateTaskExportInput = InferRequestType<
  TaskExportRoutes["$post"]
>["json"];

export type CreateWorkspaceExportInput = InferRequestType<
  TaskExportRoutes["workspace"]["$post"]
>["json"];

export type TaskExportFormat = TaskExport["format"];

export type TaskExportStatus = TaskExport["status"];

/** The history's view: the caller's exports, or everyone's (admins). */
export type TaskExportScope = "mine" | "all";
