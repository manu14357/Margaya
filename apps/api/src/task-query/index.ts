import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { boundedRequestBody } from "../utils/bounded-request-body";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import "./keys";
import { taskQueryResultSchema } from "./response";
import { runTaskQuery } from "./run";
import { MAX_TASK_QUERY_BODY_BYTES, taskQueryRequestSchema } from "./schema";

// One stateless endpoint answers every task list: board and list filters,
// spreadsheets, saved views, workspace pages and "Your work" (B4 K1).

const queryTasksRoute = createRoute({
  method: "post",
  operationId: "queryTasks",
  path: "/",
  tags: ["Tasks"],
  summary: "Query tasks",
  description:
    "Filter, group, order and page tasks across a workspace's projects in one request. Filters are an and/or tree (at most 3 levels, 50 conditions) whose set conditions use in / notIn with `none` for no value and `me` for the caller; date conditions compare calendar days in context.timeZone. Tasks in several groups (assignees, labels, modules) appear in each, with exact counts. Cycle, module and estimate values of projects with that feature off read as none. Triage tasks are never returned; archived tasks only with archived include or only. Modes: rows (groups with pages of rows and lookups), ids (every matching id, for filtering an already loaded board) and counts. Load more of one group with page.group and its nextCursor.",
  middleware: [
    boundedRequestBody(MAX_TASK_QUERY_BODY_BYTES),
    workspaceAccess.fromBody(),
    requireWorkspacePermission({ task: ["read"] }),
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: taskQueryRequestSchema } },
    },
  },
  responses: {
    200: jsonResponse(
      "The matching tasks: groups with rows and lookups, ids, or counts",
      taskQueryResultSchema,
    ),
    400: errorResponse(
      "Invalid body, an unsupported filter or operator, filters too complex, an invalid date or time zone, an unknown custom field, a grouping the scope cannot use, or a stale cursor",
    ),
    403: errorResponse("No workspace access, or missing task:read permission"),
    404: errorResponse("A scope project is not in the workspace"),
    413: errorResponse("The body is larger than 32 KB"),
    503: errorResponse("The query took too long; narrow the filters"),
  },
});

const taskQuery = apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  queryTasksRoute,
  async (c) => {
    const result = await runTaskQuery(c.req.valid("json"), {
      workspaceId: c.get("workspaceId"),
      userId: c.get("userId"),
    });
    return c.json(result, 200);
  },
);

export default taskQuery;

// Contracts for other slices (B4 §3.8): B8 compiles the same task set and
// group keys, B12 runs queries in a public context, B10 registers keys, and
// saved views validate what they store with the engine's schemas.
export { compileTaskScope, searchCondition } from "./compile";
export { buildQueryContext, type QueryContext } from "./context";
export {
  groupKeyExpression,
  NONE_GROUP,
  sortGroupKeys,
} from "./group";
export {
  type DateFilterKey,
  type FilterKeyDescriptor,
  filterKeyRegistry,
  RESERVED_FILTER_KEYS,
  registerFilterKey,
  type SetFilterKey,
} from "./keys";
export {
  normalizeTaskQuery,
  runTaskQuery,
  type TaskQueryCaller,
  type TaskQueryResult,
} from "./run";
export {
  type FilterNode,
  filterNodeSchema,
  taskQueryDisplaySchema,
  taskQueryRequestSchema,
} from "./schema";
export { validateFilterTree } from "./validate";
