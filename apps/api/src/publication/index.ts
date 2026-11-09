import { activitySchema } from "../activity/response";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  lookupNotFound,
  z,
} from "../openapi";
import {
  hasWorkspacePermission,
  requireWorkspacePermission,
} from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import {
  blockParticipant,
  listBlocks,
  listPublicComments,
  moderatorDeleteComment,
  setCommentVisibility,
  unblockParticipant,
} from "./moderation";
import {
  projectPublicationSchema,
  publicBoardBlockResultSchema,
  publicBoardBlockSchema,
  publicCommentModerationPageSchema,
  taskVoteSummarySchema,
} from "./response";
import {
  blockBody,
  blockParam,
  commentIdParam,
  commentListQuery,
  commentVisibilityBody,
  projectIdParam,
  publishBody,
  taskIdParam,
  updatePublicationBody,
} from "./schema";
import {
  publicationView,
  publishProject,
  rotatePublicationLink,
  unpublishProject,
  updatePublicationSettings,
} from "./service";
import { taskVoteSummary } from "./votes";
import "./subscribers";

// In-app publishing routes (B12 §3.2, tag Publishing). Moderation needs
// project:share; reading the publication needs project:read.

const TAGS = ["Publishing"];
const PROJECT_NOT_FOUND = "Project not found";
const fromProject = workspaceAccess.fromProject("projectId", {
  notFoundMessage: PROJECT_NOT_FOUND,
});
const canRead = requireWorkspacePermission({ project: ["read"] });
const canShare = requireWorkspacePermission({ project: ["share"] });
const SHARE_FORBIDDEN = "No workspace access, or missing project:share";

function jsonBody<T>(schema: T, required = true) {
  return { required, content: { "application/json": { schema } } };
}

const publicationResponses = {
  200: jsonResponse("The publication", projectPublicationSchema),
  403: errorResponse(SHARE_FORBIDDEN),
  404: errorResponse(PROJECT_NOT_FOUND),
};

const getPublicationRoute = createRoute({
  method: "get",
  operationId: "getProjectPublication",
  path: "/project/{projectId}",
  tags: TAGS,
  summary: "Get publication",
  description:
    "The project's public board: whether it is published, its link, its settings and what the server allows.",
  middleware: [fromProject, canRead] as const,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("The publication", projectPublicationSchema),
    403: errorResponse("No workspace access, or missing project:read"),
    404: errorResponse(PROJECT_NOT_FOUND),
  },
});

const publishRoute = createRoute({
  method: "post",
  operationId: "publishProject",
  path: "/project/{projectId}/publish",
  tags: TAGS,
  summary: "Publish project",
  description:
    "Publish the project as a public board, applying optional settings first. Republishing restores the same link and settings. Publishing again changes nothing.",
  middleware: [fromProject, canShare] as const,
  request: { params: projectIdParam, body: jsonBody(publishBody, false) },
  responses: {
    ...publicationResponses,
    400: errorResponse("Invalid settings"),
    409: errorResponse(
      "Public boards are off on this server, the project is archived, or requests need Intake",
    ),
  },
});

const unpublishRoute = createRoute({
  method: "post",
  operationId: "unpublishProject",
  path: "/project/{projectId}/unpublish",
  tags: TAGS,
  summary: "Unpublish project",
  description:
    "Stop the public board. The link, settings, comments, reactions, votes and blocks are kept for a later republish.",
  middleware: [fromProject, canShare] as const,
  request: { params: projectIdParam },
  responses: publicationResponses,
});

const updatePublicationRoute = createRoute({
  method: "patch",
  operationId: "updateProjectPublication",
  path: "/project/{projectId}",
  tags: TAGS,
  summary: "Update publication settings",
  description:
    "Change the board's layouts, participation and content settings, published or not. Send at least one setting.",
  middleware: [fromProject, canShare] as const,
  request: { params: projectIdParam, body: jsonBody(updatePublicationBody) },
  responses: {
    ...publicationResponses,
    400: errorResponse("No setting, unknown fields or invalid layouts"),
    409: errorResponse("Requests need the project's Intake feature"),
  },
});

const rotateRoute = createRoute({
  method: "post",
  operationId: "rotateProjectPublicationLink",
  path: "/project/{projectId}/rotate-link",
  tags: TAGS,
  summary: "Rotate public link",
  description:
    "Issue a new link. The old one stops working on the very next request.",
  middleware: [fromProject, canShare] as const,
  request: { params: projectIdParam },
  responses: publicationResponses,
});

const listCommentsRoute = createRoute({
  method: "get",
  operationId: "listProjectPublicComments",
  path: "/project/{projectId}/comments",
  tags: TAGS,
  summary: "List public comments",
  description:
    "The project's public comments, newest first, with the author's kind (member, guest or external).",
  middleware: [fromProject, canRead] as const,
  request: { params: projectIdParam, query: commentListQuery },
  responses: {
    200: jsonResponse(
      "A page of public comments",
      publicCommentModerationPageSchema,
    ),
    400: errorResponse("Invalid cursor or limit"),
    403: errorResponse("No workspace access, or missing project:read"),
    404: errorResponse(PROJECT_NOT_FOUND),
  },
});

const visibilityRoute = createRoute({
  method: "patch",
  operationId: "setCommentVisibility",
  path: "/comment/{commentId}/visibility",
  tags: TAGS,
  summary: "Set comment visibility",
  description:
    "The author (with task:update) makes their comment public, while the board is published with comments on, or internal. A reply can only be made public while the comment it answers is public. A project:share holder can only hide someone else's public comment (make it internal).",
  middleware: [workspaceAccess.fromComment("commentId")] as const,
  request: { params: commentIdParam, body: jsonBody(commentVisibilityBody) },
  responses: {
    200: jsonResponse("The comment", activitySchema),
    400: errorResponse(
      "Invalid body, or making a reply to an internal comment public",
    ),
    403: errorResponse("Only the author can change this comment's visibility"),
    404: lookupNotFound("comment"),
    409: errorResponse(
      "Public comments need a published board with comments turned on",
    ),
  },
});

const moderatorDeleteRoute = createRoute({
  method: "delete",
  operationId: "moderatorDeleteComment",
  path: "/comment/{commentId}",
  tags: TAGS,
  summary: "Remove public comment",
  description: "A moderator removes someone's public comment.",
  middleware: [workspaceAccess.fromComment("commentId"), canShare] as const,
  request: { params: commentIdParam },
  responses: {
    200: jsonResponse(
      "The removed comment",
      z.object({ id: z.string(), taskId: z.string() }),
    ),
    403: errorResponse(
      "Missing project:share, or the comment is internal (moderators only remove public comments)",
    ),
    404: lookupNotFound("comment"),
  },
});

const listBlocksRoute = createRoute({
  method: "get",
  operationId: "listPublicBoardBlocks",
  path: "/project/{projectId}/blocks",
  tags: TAGS,
  summary: "List blocked people",
  description: "People blocked from taking part on this board.",
  middleware: [fromProject, canShare] as const,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("Blocked people", z.array(publicBoardBlockSchema)),
    403: errorResponse(SHARE_FORBIDDEN),
    404: errorResponse(PROJECT_NOT_FOUND),
  },
});

const blockRoute = createRoute({
  method: "put",
  operationId: "blockPublicBoardParticipant",
  path: "/project/{projectId}/blocks/{userId}",
  tags: TAGS,
  summary: "Block person",
  description:
    "Block a person from commenting, reacting, voting and sending requests on this board; they can still read it. Optionally hide all their public comments.",
  middleware: [fromProject, canShare] as const,
  request: { params: blockParam, body: jsonBody(blockBody, false) },
  responses: {
    200: jsonResponse("The block", publicBoardBlockResultSchema),
    400: errorResponse("Blocking yourself, or an invalid body"),
    403: errorResponse(SHARE_FORBIDDEN),
    404: errorResponse("Project or person not found"),
  },
});

const unblockRoute = createRoute({
  method: "delete",
  operationId: "unblockPublicBoardParticipant",
  path: "/project/{projectId}/blocks/{userId}",
  tags: TAGS,
  summary: "Unblock person",
  description: "Let a blocked person take part on this board again.",
  middleware: [fromProject, canShare] as const,
  request: { params: blockParam },
  responses: {
    200: jsonResponse("The person", z.object({ userId: z.string() })),
    403: errorResponse(SHARE_FORBIDDEN),
    404: errorResponse(PROJECT_NOT_FOUND),
  },
});

const taskVotesRoute = createRoute({
  method: "get",
  operationId: "getTaskVotes",
  path: "/task/{taskId}/votes",
  tags: TAGS,
  summary: "Get task votes",
  description: "The task's public board votes, read-only in the app.",
  middleware: [
    workspaceAccess.fromTaskId(),
    requireWorkspacePermission({ task: ["read"] }),
  ] as const,
  request: { params: taskIdParam },
  responses: {
    200: jsonResponse("The vote summary", taskVoteSummarySchema),
    403: errorResponse("No workspace access, or missing task:read"),
    404: lookupNotFound("task"),
  },
});

type PublicationVariables = BaseVariables & { workspaceId: string };

function actorOf(
  c: { get: (key: "workspaceId" | "userId") => string },
  projectId: string,
) {
  return {
    projectId,
    workspaceId: c.get("workspaceId"),
    userId: c.get("userId"),
  };
}

const publication = apiRouter<PublicationVariables>()
  .openapi(getPublicationRoute, async (c) =>
    c.json(
      await publicationView(c.req.valid("param").projectId, {
        canManage: await hasWorkspacePermission(c, { project: ["share"] }),
      }),
      200,
    ),
  )
  .openapi(publishRoute, async (c) => {
    const actor = actorOf(c, c.req.valid("param").projectId);
    await publishProject(actor, c.req.valid("json") ?? {});
    return c.json(
      await publicationView(actor.projectId, { canManage: true }),
      200,
    );
  })
  .openapi(unpublishRoute, async (c) => {
    const actor = actorOf(c, c.req.valid("param").projectId);
    await unpublishProject(actor);
    return c.json(
      await publicationView(actor.projectId, { canManage: true }),
      200,
    );
  })
  .openapi(updatePublicationRoute, async (c) => {
    const actor = actorOf(c, c.req.valid("param").projectId);
    await updatePublicationSettings(actor, c.req.valid("json"));
    return c.json(
      await publicationView(actor.projectId, { canManage: true }),
      200,
    );
  })
  .openapi(rotateRoute, async (c) => {
    const actor = actorOf(c, c.req.valid("param").projectId);
    await rotatePublicationLink(actor);
    return c.json(
      await publicationView(actor.projectId, { canManage: true }),
      200,
    );
  })
  .openapi(listCommentsRoute, async (c) =>
    c.json(
      await listPublicComments(
        c.req.valid("param").projectId,
        c.req.valid("query"),
      ),
      200,
    ),
  )
  .openapi(visibilityRoute, async (c) =>
    c.json(
      await setCommentVisibility({
        commentId: c.req.valid("param").commentId,
        userId: c.get("userId"),
        visibility: c.req.valid("json").visibility,
        canUpdateTasks: await hasWorkspacePermission(c, { task: ["update"] }),
        canShare: await hasWorkspacePermission(c, { project: ["share"] }),
      }),
      200,
    ),
  )
  .openapi(moderatorDeleteRoute, async (c) =>
    c.json(
      await moderatorDeleteComment(
        c.req.valid("param").commentId,
        c.get("userId"),
      ),
      200,
    ),
  )
  .openapi(listBlocksRoute, async (c) =>
    c.json(await listBlocks(c.req.valid("param").projectId), 200),
  )
  .openapi(blockRoute, async (c) => {
    const { userId: targetUserId } = c.req.valid("param");
    return c.json(
      await blockParticipant(
        actorOf(c, c.req.valid("param").projectId),
        targetUserId,
        c.req.valid("json") ?? {},
      ),
      200,
    );
  })
  .openapi(unblockRoute, async (c) =>
    c.json(
      await unblockParticipant(
        actorOf(c, c.req.valid("param").projectId),
        c.req.valid("param").userId,
      ),
      200,
    ),
  )
  .openapi(taskVotesRoute, async (c) =>
    c.json(await taskVoteSummary(c.req.valid("param").taskId), 200),
  );

export default publication;
