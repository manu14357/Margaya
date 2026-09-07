import { and, eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { activityTable } from "../database/schema";
import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import {
  getTaskReactions,
  setCommentReaction,
  setTaskReaction,
} from "./controllers/reactions";
import { reactionGroupListSchema, taskReactionsSchema } from "./response";
import {
  commentReactionParam,
  taskReactionParam,
  taskReactionsParam,
} from "./schema";

// Reacting is personal and bounded, so task:read is enough (viewers can
// react). Neither route changes the task.

/** A comment id that is not a comment answers 404 before access checks. */
async function requireComment(c: Context, next: Next) {
  const id = c.req.param("id");
  const [comment] = id
    ? await db
        .select({ id: activityTable.id })
        .from(activityTable)
        .where(and(eq(activityTable.id, id), eq(activityTable.type, "comment")))
        .limit(1)
    : [];
  if (!comment) throw new HTTPException(404, { message: "Comment not found" });
  return next();
}

const taskMiddleware = [
  workspaceAccess.fromTaskId(),
  requireWorkspacePermission({ task: ["read"] }),
] as const;

const commentMiddleware = [
  requireComment,
  workspaceAccess.fromComment(),
  requireWorkspacePermission({ task: ["read"] }),
] as const;

const taskErrors = {
  400: errorResponse(
    "Unsupported reaction, or an unknown task whose workspace could not be determined",
  ),
  403: errorResponse("No workspace access, or missing task:read permission"),
  404: errorResponse("Task not found"),
};

const commentErrors = {
  400: errorResponse("Unsupported reaction"),
  403: errorResponse("No workspace access, or missing task:read permission"),
  404: errorResponse("Comment not found"),
};

const getTaskReactionsRoute = createRoute({
  method: "get",
  operationId: "getTaskReactions",
  path: "/task/{taskId}",
  tags: ["Reactions"],
  summary: "Get task reactions",
  description:
    "Reactions on a task and on each of its comments, in one response. Groups are ordered by each emoji's first use and list up to 10 users, earliest first.",
  middleware: [...taskMiddleware] as const,
  request: { params: taskReactionsParam },
  responses: {
    200: jsonResponse(
      "The task's and its comments' reactions",
      taskReactionsSchema,
    ),
    400: errorResponse(
      "Unknown task, or its workspace could not be determined",
    ),
    403: errorResponse("No workspace access, or missing task:read permission"),
  },
});

const addTaskReactionRoute = createRoute({
  method: "put",
  operationId: "addTaskReaction",
  path: "/task/{taskId}/{emoji}",
  tags: ["Reactions"],
  summary: "Add task reaction",
  description:
    "React to a task with one of the allowed reactions. Idempotent. Returns the task's reaction groups.",
  middleware: [...taskMiddleware] as const,
  request: { params: taskReactionParam },
  responses: {
    200: jsonResponse("The task's reaction groups", reactionGroupListSchema),
    ...taskErrors,
  },
});

const removeTaskReactionRoute = createRoute({
  method: "delete",
  operationId: "removeTaskReaction",
  path: "/task/{taskId}/{emoji}",
  tags: ["Reactions"],
  summary: "Remove task reaction",
  description:
    "Remove the current user's reaction from a task. Idempotent. Returns the task's reaction groups.",
  middleware: [...taskMiddleware] as const,
  request: { params: taskReactionParam },
  responses: {
    200: jsonResponse("The task's reaction groups", reactionGroupListSchema),
    ...taskErrors,
  },
});

const addCommentReactionRoute = createRoute({
  method: "put",
  operationId: "addCommentReaction",
  path: "/comment/{id}/{emoji}",
  tags: ["Reactions"],
  summary: "Add comment reaction",
  description:
    "React to a comment with one of the allowed reactions. Idempotent. Returns the comment's reaction groups.",
  middleware: [...commentMiddleware] as const,
  request: { params: commentReactionParam },
  responses: {
    200: jsonResponse("The comment's reaction groups", reactionGroupListSchema),
    ...commentErrors,
  },
});

const removeCommentReactionRoute = createRoute({
  method: "delete",
  operationId: "removeCommentReaction",
  path: "/comment/{id}/{emoji}",
  tags: ["Reactions"],
  summary: "Remove comment reaction",
  description:
    "Remove the current user's reaction from a comment. Idempotent. Returns the comment's reaction groups.",
  middleware: [...commentMiddleware] as const,
  request: { params: commentReactionParam },
  responses: {
    200: jsonResponse("The comment's reaction groups", reactionGroupListSchema),
    ...commentErrors,
  },
});

const reaction = apiRouter()
  .openapi(getTaskReactionsRoute, async (c) =>
    c.json(
      await getTaskReactions(c.req.valid("param").taskId, c.get("userId")),
      200,
    ),
  )
  .openapi(addTaskReactionRoute, async (c) => {
    const { taskId, emoji } = c.req.valid("param");
    return c.json(
      await setTaskReaction(taskId, emoji, c.get("userId"), true),
      200,
    );
  })
  .openapi(removeTaskReactionRoute, async (c) => {
    const { taskId, emoji } = c.req.valid("param");
    return c.json(
      await setTaskReaction(taskId, emoji, c.get("userId"), false),
      200,
    );
  })
  .openapi(addCommentReactionRoute, async (c) => {
    const { id, emoji } = c.req.valid("param");
    return c.json(
      await setCommentReaction(id, emoji, c.get("userId"), true),
      200,
    );
  })
  .openapi(removeCommentReactionRoute, async (c) => {
    const { id, emoji } = c.req.valid("param");
    return c.json(
      await setCommentReaction(id, emoji, c.get("userId"), false),
      200,
    );
  });

export default reaction;
