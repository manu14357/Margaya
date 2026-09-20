import type { client } from "@margaya/libs";
import type { InferRequestType, InferResponseType } from "hono/client";

// The task query engine's request and result, inferred from the typed client
// (POST /api/task-query). The filter tree model lives in lib/task-query.

type QueryTasksEndpoint = (typeof client)["task-query"]["$post"];

export type TaskQueryRequest = InferRequestType<QueryTasksEndpoint>["json"];

export type TaskQueryResult = InferResponseType<QueryTasksEndpoint, 200>;

export type TaskQueryRow = TaskQueryResult["tasks"][string];

export type TaskQueryGroup = TaskQueryResult["groups"][number];

export type TaskQuerySubGroup = NonNullable<
  TaskQueryGroup["subGroups"]
>[number];

export type TaskQueryMeta = TaskQueryResult["meta"];

export type TaskQueryMetaUser = TaskQueryMeta["users"][number];

export type TaskQueryMetaProject = TaskQueryMeta["projects"][number];

export type TaskQueryMetaColumn = TaskQueryMeta["columns"][number];

export type TaskQueryInclude = NonNullable<TaskQueryRequest["include"]>[number];

export type TaskQueryMode = NonNullable<TaskQueryRequest["mode"]>;
