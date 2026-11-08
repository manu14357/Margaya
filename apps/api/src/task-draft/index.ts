import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { requireEntitlement } from "../billing/require-entitlement-middleware";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { hiddenForCurrentRequest } from "../project/visibility";
import { boundedRequestBody } from "../utils/bounded-request-body";
import {
  hasWorkspacePermission,
  requireWorkspacePermission,
} from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { draftAccess } from "./access";
import { publishTaskDraft } from "./controllers/publish-draft";
import {
  countTaskDrafts,
  getTaskDraft,
  listTaskDrafts,
} from "./controllers/read-drafts";
import {
  createTaskDraft,
  deleteTaskDraft,
  updateTaskDraft,
} from "./controllers/write-drafts";
import {
  publishedTaskDraftSchema,
  taskDraftCountSchema,
  taskDraftDeletedSchema,
  taskDraftListSchema,
  taskDraftSchema,
} from "./response";
import {
  countTaskDraftsQuery,
  createTaskDraftBody,
  listTaskDraftsQuery,
  TASK_DRAFT_BODY_BYTES,
  taskDraftParam,
  updateTaskDraftBody,
} from "./schema";

// Drafts are private: every route is scoped to the caller's own drafts, and
// another person's draft answers 404, never 403 (admins included).

const TAGS = ["Drafts"];
const createTasks = requireWorkspacePermission({ task: ["create"] });
const notFound = errorResponse("No draft with this id belongs to the caller");

// Choosing a parent changes that task's subtasks once published, which the
// relation routes guard with task:update; the draft asks for it up front.
async function assertCanSetParent(
  c: Context,
  parentTaskId: string | null | undefined,
) {
  if (
    parentTaskId &&
    !(await hasWorkspacePermission(c, { task: ["update"] }))
  ) {
    throw new HTTPException(403, { message: "Insufficient permissions" });
  }
}

/**
 * Publishing with another project in the body creates the task there, so that
 * project's role caps the request, not the stored one draftAccess checked. A
 * project the caller can't reach is left to validation, which answers 404.
 */
async function capToPublishProject(
  c: Context,
  projectId: string | null | undefined,
) {
  if (!projectId || projectId === c.get("projectId")) return;
  const hidden = await hiddenForCurrentRequest(c.get("workspaceId"));
  if (hidden.includes(projectId)) return;
  c.set("projectId", projectId);
  if (!(await hasWorkspacePermission(c, { task: ["create"] }))) {
    throw new HTTPException(403, { message: "Insufficient permissions" });
  }
}

function jsonBody<T>(schema: T, required = true) {
  return { required, content: { "application/json": { schema } } };
}

const listTaskDraftsRoute = createRoute({
  method: "get",
  operationId: "listTaskDrafts",
  path: "/",
  tags: TAGS,
  summary: "List drafts",
  description:
    "One page of the caller's own drafts in a workspace, most recently edited first. Filter by project (or `none`) and by title.",
  middleware: [workspaceAccess.fromQuery()] as const,
  request: { query: listTaskDraftsQuery },
  responses: {
    200: jsonResponse("A page of the caller's drafts", taskDraftListSchema),
    400: errorResponse("Invalid query"),
    403: errorResponse("No workspace access"),
  },
});

const countTaskDraftsRoute = createRoute({
  method: "get",
  operationId: "countTaskDrafts",
  path: "/count",
  tags: TAGS,
  summary: "Count drafts",
  description: "How many drafts the caller has in a workspace.",
  middleware: [workspaceAccess.fromQuery()] as const,
  request: { query: countTaskDraftsQuery },
  responses: {
    200: jsonResponse("The caller's draft count", taskDraftCountSchema),
    400: errorResponse("Workspace ID could not be determined"),
    403: errorResponse("No workspace access"),
  },
});

const createTaskDraftRoute = createRoute({
  method: "post",
  operationId: "createTaskDraft",
  path: "/",
  tags: TAGS,
  summary: "Create draft",
  description:
    "Save a task as a private draft. Every field is optional; a project and a title are needed only to publish. At most 1,000 drafts per user and workspace. Needs task:create, and task:update to set `parentTaskId`.",
  middleware: [
    boundedRequestBody(TASK_DRAFT_BODY_BYTES),
    workspaceAccess.fromBody(),
    createTasks,
    requireEntitlement,
  ] as const,
  request: { body: jsonBody(createTaskDraftBody) },
  responses: {
    200: jsonResponse("The new draft", taskDraftSchema),
    400: errorResponse(
      "Invalid body, or a value that doesn't fit the draft's project or workspace",
    ),
    403: errorResponse(
      "No workspace access, missing task:create permission (or task:update with `parentTaskId`), or a feature of the project is off",
    ),
    404: errorResponse("Project not found"),
    409: errorResponse(
      "The project is archived, or the caller already has 1,000 drafts here",
    ),
    413: errorResponse("The body is larger than 1 MiB"),
  },
});

const getTaskDraftRoute = createRoute({
  method: "get",
  operationId: "getTaskDraft",
  path: "/{id}",
  tags: TAGS,
  summary: "Get draft",
  description: "One of the caller's drafts, with its description.",
  middleware: [draftAccess()] as const,
  request: { params: taskDraftParam },
  responses: {
    200: jsonResponse("The draft", taskDraftSchema),
    403: errorResponse("The caller no longer belongs to the workspace"),
    404: notFound,
  },
});

const updateTaskDraftRoute = createRoute({
  method: "patch",
  operationId: "updateTaskDraft",
  path: "/{id}",
  tags: TAGS,
  summary: "Update draft",
  description:
    "Change some fields of the caller's draft. A new project clears status, custom fields, cycle, modules, estimate and parent unless they are sent too. Sending only stored values changes nothing. Needs task:create, and task:update to set `parentTaskId`.",
  middleware: [
    boundedRequestBody(TASK_DRAFT_BODY_BYTES),
    draftAccess(),
    createTasks,
    requireEntitlement,
  ] as const,
  request: { params: taskDraftParam, body: jsonBody(updateTaskDraftBody) },
  responses: {
    200: jsonResponse("The draft after the change", taskDraftSchema),
    400: errorResponse(
      "Invalid body, nothing to change, or a value that doesn't fit the draft's project or workspace",
    ),
    403: errorResponse(
      "No workspace access, missing task:create permission (or task:update with `parentTaskId`), or a feature of the project is off",
    ),
    404: errorResponse("Draft or project not found"),
    409: errorResponse("The project is archived"),
    413: errorResponse("The body is larger than 1 MiB"),
  },
});

const deleteTaskDraftRoute = createRoute({
  method: "delete",
  operationId: "deleteTaskDraft",
  path: "/{id}",
  tags: TAGS,
  summary: "Delete draft",
  description:
    "Delete one of the caller's drafts for good. Needs no task permission, so anyone can clean up their own drafts.",
  middleware: [draftAccess()] as const,
  request: { params: taskDraftParam },
  responses: {
    200: jsonResponse("The draft was deleted", taskDraftDeletedSchema),
    403: errorResponse("The caller no longer belongs to the workspace"),
    404: notFound,
  },
});

const publishTaskDraftRoute = createRoute({
  method: "post",
  operationId: "publishTaskDraft",
  path: "/{id}/publish",
  tags: TAGS,
  summary: "Publish draft",
  description:
    "Turn the caller's draft into a task and delete the draft. An optional body is saved to the draft first, like an update, and kept even if publishing fails. The task gets the next number, the caller as creator, the draft's labels, cycle, modules, estimate and parent; values that stopped being valid (or a parent the caller may no longer link, which needs task:update) are left out and listed in `dropped`. Publishes task.created and the label, membership and relation events. Needs task:create, in the project named in the body when there is one.",
  middleware: [
    boundedRequestBody(TASK_DRAFT_BODY_BYTES),
    draftAccess(),
    createTasks,
    requireEntitlement,
  ] as const,
  request: {
    params: taskDraftParam,
    body: jsonBody(updateTaskDraftBody, false),
  },
  responses: {
    200: jsonResponse("The new task", publishedTaskDraftSchema),
    400: errorResponse(
      "No project, a blank title, a required custom field without a value, or an invalid patch",
    ),
    403: errorResponse(
      "No workspace access, missing task:create permission (or task:update with `parentTaskId`), or a feature of the project is off",
    ),
    404: errorResponse("Draft or project not found"),
    409: errorResponse("The project is archived"),
    413: errorResponse("The body is larger than 1 MiB"),
  },
});

const taskDraft = apiRouter<
  BaseVariables & { workspaceId: string; projectId: string | null }
>()
  .openapi(countTaskDraftsRoute, async (c) =>
    c.json(await countTaskDrafts(c.get("userId"), c.get("workspaceId")), 200),
  )
  .openapi(listTaskDraftsRoute, async (c) => {
    const { projectId, search, page, limit } = c.req.valid("query");
    return c.json(
      await listTaskDrafts({
        userId: c.get("userId"),
        workspaceId: c.get("workspaceId"),
        projectId,
        search,
        page,
        limit,
      }),
      200,
    );
  })
  .openapi(createTaskDraftRoute, async (c) => {
    const { workspaceId: _workspaceId, ...patch } = c.req.valid("json");
    await assertCanSetParent(c, patch.parentTaskId);
    return c.json(
      await createTaskDraft({
        userId: c.get("userId"),
        workspaceId: c.get("workspaceId"),
        patch,
      }),
      200,
    );
  })
  .openapi(getTaskDraftRoute, async (c) =>
    c.json(await getTaskDraft(c.req.valid("param").id, c.get("userId")), 200),
  )
  .openapi(updateTaskDraftRoute, async (c) => {
    const patch = c.req.valid("json");
    await assertCanSetParent(c, patch.parentTaskId);
    return c.json(
      await updateTaskDraft({
        draftId: c.req.valid("param").id,
        userId: c.get("userId"),
        patch,
      }),
      200,
    );
  })
  .openapi(deleteTaskDraftRoute, async (c) =>
    c.json(
      await deleteTaskDraft(c.req.valid("param").id, c.get("userId")),
      200,
    ),
  )
  .openapi(publishTaskDraftRoute, async (c) => {
    const patch = c.req.valid("json") ?? {};
    await capToPublishProject(c, patch.projectId);
    await assertCanSetParent(c, patch.parentTaskId);
    return c.json(
      await publishTaskDraft({
        draftId: c.req.valid("param").id,
        userId: c.get("userId"),
        patch,
        canLinkParent: await hasWorkspacePermission(c, { task: ["update"] }),
        authorizedProjectId: c.get("projectId") ?? undefined,
      }),
      200,
    );
  });

export default taskDraft;
