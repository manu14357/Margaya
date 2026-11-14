import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { projectTable } from "../database/schema";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import { requestHiddenProjectIds } from "../project/visibility";
import {
  hasWorkspacePermission,
  requireWorkspacePermission,
} from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import {
  projectUpdateAccess,
  projectUpdateCommentAccess,
  requireUpdatesFeatureForEntity,
  requireUpdatesFeatureForProject,
} from "./access";
import {
  addComment,
  deleteComment,
  getFollowState,
  latestUpdates,
  listComments,
  setFollowState,
  setReaction,
} from "./controllers/social";
import {
  type Caller,
  createProjectUpdate,
  deleteProjectUpdate,
  editProjectUpdate,
  getProjectUpdateView,
  listProjectUpdates,
} from "./controllers/updates";
import { draftProjectUpdate } from "./draft";
import { getReminder, setReminder } from "./reminder";
import {
  latestProjectUpdatesSchema,
  projectUpdateCommentSchema,
  projectUpdateDetailSchema,
  projectUpdateDraftSchema,
  projectUpdateFollowSchema,
  projectUpdateListSchema,
  projectUpdateReminderSchema,
  projectUpdateSchema,
  reactionsSchema,
} from "./response";
import {
  commentIdParam,
  createCommentBody,
  createUpdateBody,
  draftUpdateBody,
  followBody,
  listUpdatesQuery,
  patchUpdateBody,
  projectIdParam,
  reactionParam,
  reminderBody,
  updateIdParam,
  workspaceIdParam,
} from "./schema";
import "./notify";

// Project status updates (#7): a per-project, opt-in timeline of dated
// updates with a health value, comments and reactions, drafted from live
// data (template, or AI through the gateway). Reading needs project:read,
// posting and commenting task:update, and changing other people's updates
// or the reminder project:update. Every route answers 403 while the
// project's Updates feature is off.

const TAGS = ["Project updates"];

const readProject = [
  workspaceAccess.fromProject("projectId"),
  requireWorkspacePermission({ project: ["read"] }),
  requireUpdatesFeatureForProject,
] as const;

const writeProject = [
  workspaceAccess.fromProject("projectId"),
  requireWorkspacePermission({ task: ["update"] }),
  requireUpdatesFeatureForProject,
] as const;

const readUpdate = [
  projectUpdateAccess(),
  requireWorkspacePermission({ project: ["read"] }),
  requireUpdatesFeatureForEntity,
] as const;

const writeUpdate = [
  projectUpdateAccess(),
  requireWorkspacePermission({ task: ["update"] }),
  requireUpdatesFeatureForEntity,
] as const;

const featureOff =
  "No access, a missing permission, or Updates is off for the project";

async function callerOf(c: Context): Promise<Caller> {
  return {
    userId: c.get("userId") as string,
    canManage: await hasWorkspacePermission(c, { project: ["update"] }),
  };
}

async function projectName(projectId: string): Promise<string> {
  const [row] = await db
    .select({ name: projectTable.name })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: "Project not found" });
  return row.name;
}

const listRoute = createRoute({
  method: "get",
  operationId: "listProjectUpdates",
  path: "/project/{projectId}",
  tags: TAGS,
  summary: "List a project's updates",
  description:
    "The project's status updates, newest first, with comment counts and reactions. Page with `cursor`.",
  middleware: [...readProject] as const,
  request: { params: projectIdParam, query: listUpdatesQuery },
  responses: {
    200: jsonResponse("A page of updates", projectUpdateListSchema),
    400: errorResponse("Invalid cursor"),
    403: errorResponse(featureOff),
    404: errorResponse("Project not found"),
  },
});

const createRouteDef = createRoute({
  method: "post",
  operationId: "createProjectUpdate",
  path: "/project/{projectId}",
  tags: TAGS,
  summary: "Post a project update",
  description:
    "Post a status update to the project's timeline. The server keeps the project's computed facts with it and notifies the project's followers. Needs task:update.",
  middleware: [...writeProject] as const,
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: createUpdateBody } },
    },
  },
  responses: {
    200: jsonResponse("The posted update", projectUpdateSchema),
    403: errorResponse(featureOff),
    404: errorResponse("Project not found"),
  },
});

const draftRoute = createRoute({
  method: "post",
  operationId: "draftProjectUpdate",
  path: "/project/{projectId}/draft",
  tags: TAGS,
  summary: "Draft a project update",
  description:
    "Compute the project's facts since its last update (completed and moved tasks, overdue and blocked work, active cycles, delivery risks, forecast) and draft an update from them. With AI on and `useAi`, a model writes the text through the AI gateway from those facts only; otherwise, or when AI is unavailable, a fixed template does. Nothing is saved. Needs task:update (and ai:use for the AI draft).",
  middleware: [...writeProject] as const,
  request: {
    params: projectIdParam,
    body: {
      required: false,
      content: { "application/json": { schema: draftUpdateBody } },
    },
  },
  responses: {
    200: jsonResponse("Facts and a draft", projectUpdateDraftSchema),
    403: errorResponse(featureOff),
    404: errorResponse("Project not found"),
  },
});

const getFollowRoute = createRoute({
  method: "get",
  operationId: "getProjectUpdateFollow",
  path: "/project/{projectId}/follow",
  tags: TAGS,
  summary: "Whether you follow a project's updates",
  description:
    "Whether the caller follows the project's status updates, and whether they are its lead (the lead follows unless they unfollowed). Needs the Updates feature and access to the project.",
  middleware: [...readProject] as const,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("Follow state", projectUpdateFollowSchema),
    403: errorResponse(featureOff),
    404: errorResponse("Project not found"),
  },
});

const setFollowRoute = createRoute({
  method: "put",
  operationId: "setProjectUpdateFollow",
  path: "/project/{projectId}/follow",
  tags: TAGS,
  summary: "Follow or unfollow a project's updates",
  description:
    "Followers are notified of new updates and get them in their email digest. The project lead follows unless they unfollow.",
  middleware: [...readProject] as const,
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: followBody } },
    },
  },
  responses: {
    200: jsonResponse("Follow state", projectUpdateFollowSchema),
    403: errorResponse(featureOff),
    404: errorResponse("Project not found"),
  },
});

const getReminderRoute = createRoute({
  method: "get",
  operationId: "getProjectUpdateReminder",
  path: "/project/{projectId}/reminder",
  tags: TAGS,
  summary: "Get the weekly update reminder",
  description:
    "Whether the weekly reminder to post an update is on, its weekday (0 is Sunday) and the project lead it goes to. Anyone who can see the project can read it; changing it needs project:update.",
  middleware: [...readProject] as const,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("Reminder settings", projectUpdateReminderSchema),
    403: errorResponse(featureOff),
    404: errorResponse("Project not found"),
  },
});

const setReminderRoute = createRoute({
  method: "put",
  operationId: "setProjectUpdateReminder",
  path: "/project/{projectId}/reminder",
  tags: TAGS,
  summary: "Set the weekly update reminder",
  description:
    "Remind the project lead on a weekday (from 9:00 in the workspace's time zone) to post an update, unless one was posted in the last 6 days. Needs project:update.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ project: ["update"] }),
    requireUpdatesFeatureForProject,
  ] as const,
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: reminderBody } },
    },
  },
  responses: {
    200: jsonResponse("Reminder settings", projectUpdateReminderSchema),
    403: errorResponse(featureOff),
    404: errorResponse("Project not found"),
  },
});

const latestRoute = createRoute({
  method: "get",
  operationId: "listLatestProjectUpdates",
  path: "/workspace/{workspaceId}/latest",
  tags: TAGS,
  summary: "Latest update of each project",
  description:
    "The newest update of each project you can see that has Updates on, newest first (Home widget and roll-up).",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission({ project: ["read"] }),
  ] as const,
  request: {
    params: workspaceIdParam,
    query: z.object({
      limit: z.coerce.number().int().min(1).max(50).optional(),
    }),
  },
  responses: {
    200: jsonResponse("Latest updates", latestProjectUpdatesSchema),
    403: errorResponse("No workspace access, or missing project:read"),
  },
});

const deleteCommentRoute = createRoute({
  method: "delete",
  operationId: "deleteProjectUpdateComment",
  path: "/comment/{commentId}",
  tags: TAGS,
  summary: "Delete a comment on an update",
  description:
    "Its author, or someone with project:update, may delete a comment.",
  middleware: [
    projectUpdateCommentAccess(),
    requireWorkspacePermission({ task: ["update"] }),
    requireUpdatesFeatureForEntity,
  ] as const,
  request: { params: commentIdParam },
  responses: {
    200: jsonResponse(
      "Deleted",
      z.object({ id: z.string(), deleted: z.literal(true) }),
    ),
    403: errorResponse(featureOff),
    404: errorResponse("Comment not found"),
  },
});

const getRoute = createRoute({
  method: "get",
  operationId: "getProjectUpdate",
  path: "/{id}",
  tags: TAGS,
  summary: "Get a project update",
  description: "One update with its comments, oldest first.",
  middleware: [...readUpdate] as const,
  request: { params: updateIdParam },
  responses: {
    200: jsonResponse("The update", projectUpdateDetailSchema),
    403: errorResponse(featureOff),
    404: errorResponse("Update not found"),
  },
});

const patchRoute = createRoute({
  method: "patch",
  operationId: "updateProjectUpdate",
  path: "/{id}",
  tags: TAGS,
  summary: "Edit a project update",
  description:
    "Its author, or someone with project:update, may edit an update. The kept facts and the AI-drafted label do not change.",
  middleware: [...writeUpdate] as const,
  request: {
    params: updateIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: patchUpdateBody } },
    },
  },
  responses: {
    200: jsonResponse("The edited update", projectUpdateSchema),
    403: errorResponse(`${featureOff}, or not the author`),
    404: errorResponse("Update not found"),
  },
});

const deleteRoute = createRoute({
  method: "delete",
  operationId: "deleteProjectUpdate",
  path: "/{id}",
  tags: TAGS,
  summary: "Delete a project update",
  description:
    "Its author, or someone with project:update, may delete an update, with its comments and reactions.",
  middleware: [...writeUpdate] as const,
  request: { params: updateIdParam },
  responses: {
    200: jsonResponse(
      "Deleted",
      z.object({ id: z.string(), deleted: z.literal(true) }),
    ),
    403: errorResponse(`${featureOff}, or not the author`),
    404: errorResponse("Update not found"),
  },
});

const commentRoute = createRoute({
  method: "post",
  operationId: "createProjectUpdateComment",
  path: "/{id}/comment",
  tags: TAGS,
  summary: "Comment on a project update",
  description:
    "Notifies the update's author and earlier commenters. Needs task:update.",
  middleware: [...writeUpdate] as const,
  request: {
    params: updateIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: createCommentBody } },
    },
  },
  responses: {
    200: jsonResponse("The comment", projectUpdateCommentSchema),
    403: errorResponse(featureOff),
    404: errorResponse("Update not found"),
  },
});

const addReactionRoute = createRoute({
  method: "put",
  operationId: "addProjectUpdateReaction",
  path: "/{id}/reaction/{emoji}",
  tags: TAGS,
  summary: "React to a project update",
  description: "Idempotent. Returns the update's reactions.",
  middleware: [...readUpdate] as const,
  request: { params: reactionParam },
  responses: {
    200: jsonResponse("The update's reactions", reactionsSchema),
    403: errorResponse(featureOff),
    404: errorResponse("Update not found"),
  },
});

const removeReactionRoute = createRoute({
  method: "delete",
  operationId: "removeProjectUpdateReaction",
  path: "/{id}/reaction/{emoji}",
  tags: TAGS,
  summary: "Remove your reaction from a project update",
  description: "Idempotent. Returns the update's reactions.",
  middleware: [...readUpdate] as const,
  request: { params: reactionParam },
  responses: {
    200: jsonResponse("The update's reactions", reactionsSchema),
    403: errorResponse(featureOff),
    404: errorResponse("Update not found"),
  },
});

const projectUpdate = apiRouter<
  BaseVariables & { workspaceId: string; projectId?: string }
>()
  .openapi(listRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const { limit, cursor } = c.req.valid("query");
    return c.json(
      await listProjectUpdates(projectId, await callerOf(c), {
        limit,
        cursor,
      }),
      200,
    );
  })
  .openapi(createRouteDef, async (c) => {
    const { projectId } = c.req.valid("param");
    const body = c.req.valid("json");
    return c.json(
      await createProjectUpdate(
        { ...body, projectId, workspaceId: c.get("workspaceId") },
        await callerOf(c),
      ),
      200,
    );
  })
  .openapi(draftRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const body = c.req.valid("json") ?? {};
    return c.json(
      await draftProjectUpdate(c, {
        projectId,
        projectName: await projectName(projectId),
        useAi: body.useAi !== false,
        locale: body.locale,
      }),
      200,
    );
  })
  .openapi(getFollowRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    return c.json(await getFollowState(projectId, c.get("userId")), 200);
  })
  .openapi(setFollowRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const { following } = c.req.valid("json");
    return c.json(
      await setFollowState(projectId, c.get("userId"), following),
      200,
    );
  })
  .openapi(getReminderRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    return c.json(await getReminder(projectId), 200);
  })
  .openapi(setReminderRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    return c.json(await setReminder(projectId, c.req.valid("json")), 200);
  })
  .openapi(latestRoute, async (c) => {
    const { limit } = c.req.valid("query");
    return c.json(
      await latestUpdates(
        c.get("workspaceId"),
        await requestHiddenProjectIds(c),
        limit ?? 10,
      ),
      200,
    );
  })
  .openapi(deleteCommentRoute, async (c) => {
    const { commentId } = c.req.valid("param");
    return c.json(await deleteComment(commentId, await callerOf(c)), 200);
  })
  .openapi(getRoute, async (c) => {
    const { id } = c.req.valid("param");
    const caller = await callerOf(c);
    const [update, comments] = await Promise.all([
      getProjectUpdateView(id, caller),
      listComments(id, caller),
    ]);
    return c.json({ ...update, comments }, 200);
  })
  .openapi(patchRoute, async (c) => {
    const { id } = c.req.valid("param");
    return c.json(
      await editProjectUpdate(id, c.req.valid("json"), await callerOf(c)),
      200,
    );
  })
  .openapi(deleteRoute, async (c) => {
    const { id } = c.req.valid("param");
    return c.json(await deleteProjectUpdate(id, await callerOf(c)), 200);
  })
  .openapi(commentRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { content } = c.req.valid("json");
    return c.json(await addComment(id, content, await callerOf(c)), 200);
  })
  .openapi(addReactionRoute, async (c) => {
    const { id, emoji } = c.req.valid("param");
    return c.json(await setReaction(id, emoji, true, await callerOf(c)), 200);
  })
  .openapi(removeReactionRoute, async (c) => {
    const { id, emoji } = c.req.valid("param");
    return c.json(await setReaction(id, emoji, false, await callerOf(c)), 200);
  });

export default projectUpdate;
